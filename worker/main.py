
"""QuoteCraft: dark motivational quote poster + optional effect Shorts renderer."""
from __future__ import annotations
import base64, io, json, os, random, re, shutil, subprocess
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, features

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'output'; OUT.mkdir(exist_ok=True)
app=FastAPI(title='QuoteCraft Poster Rendering Worker')

class RenderRequest(BaseModel):
    jobId: str
    post: dict
    brand: str='Quote Craft'
    handle: str='@yourpage'
    style: Literal['midnight','editorial','sunset']='midnight'
    size: Literal['portrait','square']='portrait'
    withVideo: bool=False
    videoSeconds: int=Field(5,ge=5,le=10)
    effectEnabled: bool=False
    effectStyle: Literal['none','reference','softGlow','float']='none'
    imageMode: Literal['commons','illustration','upload']='illustration'
    imageDataUrl: str=''
    iconDataUrl: str=''

THEMES={
 'midnight':{'bg':'#060606','primary':'#fafafa','sub':'#dcdcdc','accent':'#e4c36a'},
 'editorial':{'bg':'#101010','primary':'#ffffff','sub':'#d7d7d7','accent':'#c9c9c9'},
 'sunset':{'bg':'#0b0b0f','primary':'#fff8ef','sub':'#ead9c8','accent':'#d5b06a'}
}
_FONT_CACHE={}

def font_path(hindi=True,bold=True):
    key=(hindi,bold)
    if key in _FONT_CACHE:return _FONT_CACHE[key]
    if os.name=='nt':
        names=['NirmalaB.ttf','Nirmala.ttf','mangalb.ttf','mangal.ttf'] if hindi else ['georgiab.ttf','Georgia.ttf','timesbd.ttf','times.ttf','arialbd.ttf','arial.ttf']
        for name in names:
            p=Path('C:/Windows/Fonts')/name
            if p.exists():_FONT_CACHE[key]=str(p);return str(p)
    else:
        if shutil.which('fc-match'):
            family='Noto Sans Devanagari:style=Bold' if hindi and bold else 'Noto Sans Devanagari' if hindi else 'DejaVu Serif:style=Bold'
            p=subprocess.run(['fc-match','-f','%{file}\n',family],capture_output=True,text=True).stdout.strip().splitlines()[0]
            if Path(p).exists():_FONT_CACHE[key]=p;return p
    raise RuntimeError('Unicode font not found. Install Noto Sans Devanagari or Windows Nirmala UI.')

def get_font(px:int,hindi=True,bold=True):
    opts={'layout_engine':ImageFont.Layout.RAQM} if features.check('raqm') else {}
    return ImageFont.truetype(font_path(hindi,bold),px,**opts)

def clean_text(txt:str,limit:int=340):
    return re.sub(r'\s+',' ',str(txt or '')).strip()[:limit]

def text_width(draw,txt,font):
    return draw.textbbox((0,0),txt,font=font)[2]

def wrap_lines(draw,txt,font,max_width,max_lines=9):
    words=clean_text(txt,520).split(' ')
    if not words:return []
    lines=[]; line=''
    for word in words:
        candidate=(line+' '+word).strip()
        if text_width(draw,candidate,font)<=max_width:
            line=candidate
        else:
            if line:
                lines.append(line); line=word
            else:
                lines.append(word); line=''
    if line: lines.append(line)
    if len(lines)>max_lines:return None
    return lines

def fit_lines(draw,txt,max_width,max_height,initial=76,minsize=28,spacing=1.26,max_lines=8,hindi=True):
    for size in range(initial,minsize-1,-2):
        font=get_font(size,hindi,True)
        lines=wrap_lines(draw,txt,font,max_width,max_lines)
        if not lines: continue
        box_height=int(size*spacing*len(lines))
        if box_height<=max_height and all(text_width(draw,l,font)<=max_width for l in lines):
            return font,lines,int(size*spacing)
    raise ValueError('Text too long for poster')

def fit_support_lines(draw,txt,max_width,max_height,hindi=True):
    txt=clean_text(txt,180)
    if not txt:return None,[],0
    for size in range(34,19,-2):
        font=get_font(size,hindi,False)
        lines=wrap_lines(draw,txt,font,max_width,4)
        if not lines: continue
        step=int(size*1.28)
        if step*len(lines)<=max_height:
            return font,lines,step
    font=get_font(20,hindi,False)
    lines=wrap_lines(draw,txt[:120],font,max_width,4) or [txt[:120]]
    return font,lines,int(20*1.28)

def make_texture(size,theme):
    w,h=size
    bg=Image.new('RGB',size,THEMES[theme]['bg'])
    px=bg.load()
    random.seed(w*h)
    for y in range(h):
        for x in range(w):
            noise=random.randint(-10,10)
            base=max(0,min(255,9+noise + int(20*(1-abs((x-w/2)/(w/2))*0.38)) + int(16*(1-abs((y-h/2)/(h/2))*0.34))))
            if theme=='editorial': rgb=(base+10,base+10,base+10)
            elif theme=='sunset': rgb=(base+7,base+4,base)
            else: rgb=(base,base,base)
            px[x,y]=rgb
    bg=bg.filter(ImageFilter.GaussianBlur(0.35))
    vignette=Image.new('L',size,0)
    vd=ImageDraw.Draw(vignette)
    for i in range(18):
        margin=int(i*14)
        alpha=max(0,145-i*8)
        vd.rectangle((margin,margin,w-margin,h-margin),outline=alpha,width=24)
    bg=Image.composite(Image.new('RGB',size,(0,0,0)),bg,vignette)
    return bg

def decode_icon(dataurl:str):
    if not dataurl: return None
    if not dataurl.startswith(('data:image/png;base64,','data:image/jpeg;base64,','data:image/webp;base64,')):
        raise ValueError('Invalid icon upload')
    raw=base64.b64decode(dataurl.split(',',1)[1],validate=True)
    if len(raw)>3_000_000: raise ValueError('Icon exceeds 3 MB')
    im=Image.open(io.BytesIO(raw)); im.load()
    return im.convert('RGBA')

def circle_crop_icon(icon:Image.Image, diameter:int)->Image.Image:
    fitted=ImageOps.fit(icon,(diameter,diameter),method=Image.Resampling.LANCZOS,centering=(0.5,0.5)).convert('RGBA')
    mask=Image.new('L',(diameter,diameter),0)
    md=ImageDraw.Draw(mask)
    md.ellipse((0,0,diameter-1,diameter-1),fill=255)
    fitted.putalpha(mask)
    return fitted

def paste_uploaded_icon(base:Image.Image, icon:Image.Image, theme:str):
    w,h=base.size
    t=THEMES[theme]
    diameter=82 if h>1200 else 74
    framed=Image.new('RGBA',(diameter+16,diameter+16),(0,0,0,0))
    fd=ImageDraw.Draw(framed)
    fd.ellipse((0,0,diameter+15,diameter+15),fill=(0,0,0,220),outline=t['accent'],width=2)
    circ=circle_crop_icon(icon,diameter)
    framed.paste(circ,(8,8),circ)
    x=(w-framed.size[0])//2
    y=h-160 if h>1200 else h-148
    base.paste(framed,(x,y),framed)

def draw_poster(post,brand,handle,style,size,directory,icon:Image.Image|None=None):
    w,h=(1080,1350) if size=='portrait' else (1080,1080)
    image=make_texture((w,h),style)
    d=ImageDraw.Draw(image,'RGBA')
    t=THEMES[style]
    handle_text=clean_text(handle,40)
    d.text((70,72),handle_text,font=get_font(28,False,False),fill=(230,230,230,185))
    quote=clean_text(post.get('headline',''),280)
    detail=clean_text(post.get('detail',''),140)
    eyebrow=clean_text(post.get('eyebrow',''),28)
    hindi=bool(re.search('[\u0900-\u097F]',quote+detail+eyebrow))
    top_reserved=170
    bottom_reserved=220 if icon is not None else 120
    available_h=h-top_reserved-bottom_reserved
    max_quote_h=int(available_h*0.7)
    max_detail_h=max(54, available_h-max_quote_h-40)
    qfont, qlines, qstep = fit_lines(d, quote, w-170, max_quote_h, initial=78 if not hindi else 72, minsize=30, max_lines=8, hindi=hindi)
    dfont, dlines, dstep = fit_support_lines(d, detail, w-220, max_detail_h, hindi=hindi)
    eb_font=get_font(24,False,False) if eyebrow else None
    eb_gap=58 if eyebrow else 0
    detail_gap=24 if dlines else 0
    block_h=(qstep*len(qlines)) + detail_gap + (dstep*len(dlines)) + eb_gap
    y=top_reserved + max(0,(available_h-block_h)//2)
    if eyebrow:
        d.text((w//2,y),eyebrow.upper(),font=eb_font,fill=(228,228,228,210),anchor='mm')
        y+=eb_gap
    for line in qlines:
        d.text((w//2,y),line,font=qfont,fill=t['primary'],anchor='ma')
        y+=qstep
    if dlines:
        y+=detail_gap
        for line in dlines:
            d.text((w//2,y),line,font=dfont,fill=(222,222,222,215),anchor='ma')
            y+=dstep
    if icon is not None:
        paste_uploaded_icon(image,icon,style)
    file=directory/'poster.png'
    image.save(file,optimize=True)
    return file

def make_smoke_overlay(path:Path):
    w,h=720,1280
    img=Image.new('RGBA',(w,h),(0,0,0,0))
    dr=ImageDraw.Draw(img,'RGBA')
    random.seed(17)
    for _ in range(18):
        x=random.randint(-80,w-60)
        y=random.randint(0,h)
        ww=random.randint(120,280)
        hh=random.randint(70,180)
        alpha=random.randint(14,32)
        dr.ellipse((x,y,x+ww,y+hh),fill=(255,255,255,alpha))
    for _ in range(12):
        x=random.randint(-40,w-100)
        y=random.randint(h-280,h-40)
        ww=random.randint(180,380)
        hh=random.randint(50,120)
        alpha=random.randint(18,38)
        dr.ellipse((x,y,x+ww,y+hh),fill=(245,245,245,alpha))
    img=img.filter(ImageFilter.GaussianBlur(28))
    img.save(path)

def make_glow_overlay(path:Path, style:str):
    w,h=720,1280
    img=Image.new('RGBA',(w,h),(0,0,0,0))
    d=ImageDraw.Draw(img,'RGBA')
    accent=THEMES[style]['accent']
    rgb=tuple(int(accent[i:i+2],16) for i in (1,3,5))
    d.ellipse((-80,40,240,360),fill=(*rgb,28))
    d.ellipse((500,920,860,1280),fill=(*rgb,24))
    img=img.filter(ImageFilter.GaussianBlur(44))
    img.save(path)

def prepare_shorts_frame(poster_path:Path,out_dir:Path):
    poster=Image.open(poster_path).convert('RGB')
    canvas=Image.new('RGB',(720,1280),(8,8,8))
    fitted=ImageOps.contain(poster,(720,1280),method=Image.Resampling.LANCZOS)
    x=(720-fitted.width)//2
    y=(1280-fitted.height)//2
    canvas.paste(fitted,(x,y))
    frame_path=out_dir/'shorts_frame.png'
    canvas.save(frame_path)
    return frame_path

def render_video_shorts(poster_path:Path, duration:int, out_dir:Path, effect_style:str='none', theme_style:str='midnight'):
    if not shutil.which('ffmpeg'):
        raise RuntimeError('FFmpeg not found in PATH. Install FFmpeg to export MP4 videos.')
    frame_path=prepare_shorts_frame(poster_path,out_dir)
    out_mp4=out_dir/'reel.mp4'
    if effect_style=='none':
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-y','-loop','1','-i',str(frame_path),'-t',str(duration),'-r','24','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(out_mp4)]
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=180)
    else:
        smoke=out_dir/'smoke.png'; glow=out_dir/'glow.png'
        make_smoke_overlay(smoke); make_glow_overlay(glow,theme_style)
        if effect_style=='reference':
            filt=(
                "[0:v]trim=duration={d},setpts=PTS-STARTPTS[tmp1];"
                "[tmp1][1:v]overlay=x='0':y='7*sin(t*0.7)':format=auto[tmp2];"
                "[tmp2][2:v]overlay=0:0:format=auto,eq=contrast=1.01:brightness=0.005:saturation=1.01,format=yuv420p[v]"
            ).format(d=duration)
        elif effect_style=='softGlow':
            filt=(
                "[0:v]trim=duration={d},setpts=PTS-STARTPTS[tmp1];"
                "[tmp1][2:v]overlay=0:0[tmp2];"
                "[tmp2]eq=contrast=1.02:brightness=0.01:saturation=1.03,format=yuv420p[v]"
            ).format(d=duration)
        else:  # float
            filt=(
                "[0:v]trim=duration={d},setpts=PTS-STARTPTS[tmp1];"
                "[tmp1][1:v]overlay=x='0':y='6*sin(t*1.2)':format=auto[tmp2];"
                "[tmp2][2:v]overlay=0:0,format=yuv420p[v]"
            ).format(d=duration)
        cmd=['ffmpeg','-hide_banner','-loglevel','error','-y',
             '-loop','1','-i',str(frame_path),
             '-loop','1','-i',str(smoke),
             '-loop','1','-i',str(glow),
             '-filter_complex',filt,
             '-map','[v]','-t',str(duration),'-r','24','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-movflags','+faststart',str(out_mp4)]
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=180)
    if result.returncode!=0:
        raise RuntimeError('FFmpeg video render failed: '+result.stderr[-800:])
    if not out_mp4.exists() or out_mp4.stat().st_size<8000:
        raise RuntimeError('MP4 render failed or file is too small.')
    return out_mp4

def render(payload:RenderRequest):
    if not re.fullmatch(r'[0-9a-f-]{36}',payload.jobId):
        raise ValueError('Invalid job id')
    folder=OUT/payload.jobId
    folder.mkdir(exist_ok=True)
    warnings=[]
    icon=decode_icon(payload.iconDataUrl) if payload.iconDataUrl else None
    poster_path=draw_poster(payload.post,payload.brand,payload.handle,payload.style,payload.size,folder,icon)
    assets={'poster':f'/output/{payload.jobId}/poster.png','credits':f'/output/{payload.jobId}/credits.txt','metadata':f'/output/{payload.jobId}/metadata.json'}
    chosen_effect = payload.effectStyle if payload.effectEnabled else 'none'
    if payload.withVideo:
        render_video_shorts(poster_path,payload.videoSeconds,folder,chosen_effect,payload.style)
        assets['reel']=f'/output/{payload.jobId}/reel.mp4'

    # Python 3.11-compatible: compute the language BEFORE interpolating it in an f-string.
    # Avoid backslashes inside f-string expressions (PEP 701 support begins in Python 3.12).
    post_headline = payload.post.get('headline', '')
    post_language = 'Hindi' if re.search(r'[\u0900-\u097F]', post_headline) else 'English'

    credits=(
        f"POST TYPE: motivational quote poster\n"
        f"BRAND: {payload.brand}\n"
        f"HANDLE: {payload.handle}\n"
        f"STYLE: {payload.style}\n"
        f"LANGUAGE: {post_language}\n"
        f"VIDEO REQUESTED: {'yes' if payload.withVideo else 'no'}\n"
        f"VIDEO LENGTH: {payload.videoSeconds if payload.withVideo else 0}s\n"
        f"ICON UPLOADED: {'yes' if payload.iconDataUrl else 'no'}\n"
        f"EFFECT: {chosen_effect}\n\n"
        "This output is intended as an original design. Review text before publishing.\n"
    )
    (folder/'credits.txt').write_text(credits,encoding='utf-8')
    (folder/'metadata.json').write_text(json.dumps({'post':payload.post,'brand':payload.brand,'handle':payload.handle,'style':payload.style,'withVideo':payload.withVideo,'videoSeconds':payload.videoSeconds,'effect':chosen_effect,'warnings':warnings},ensure_ascii=False,indent=2),encoding='utf-8')
    license_data={'kind':'original_quote_design','creator':'QuoteCraft Studio procedural renderer','license':'Original project artwork','filePage':''}
    return {'assets':assets,'warnings':warnings,'license':license_data,'image':'original_quote_design'}

@app.get('/health')
def health():
    try: font=font_path(True)
    except Exception as exc: font='ERROR: '+str(exc)
    return {'ok':True,'ffmpeg':bool(shutil.which('ffmpeg')),'hindiFont':font,'raqm':bool(features.check('raqm'))}

@app.post('/render')
def render_endpoint(payload:RenderRequest):
    try:
        return render(payload)
    except (ValueError,RuntimeError) as exc:
        raise HTTPException(422,detail=str(exc)) from exc
