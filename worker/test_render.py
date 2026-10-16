import shutil, uuid, subprocess
from pathlib import Path
from PIL import Image
from worker.main import RenderRequest, render, OUT, font_path

def sample():
    return {
        'eyebrow':'LIFE',
        'headline':'Choose your peace over every argument.',
        'detail':'Not every opinion needs a reply.',
        'seoTitle':'Choose your peace',
        'caption':'A short original life quote.',
        'hashtags':['#LifeQuotes','#InnerPeace'],
    }

def test_unicode_font():
    assert Path(font_path(True)).exists()

def test_poster_without_uploaded_icon():
    id=str(uuid.uuid4())
    try:
        output=render(RenderRequest(jobId=id,post=sample(),handle='@myquote',withVideo=False))
        img=Image.open(OUT/id/'poster.png')
        assert img.size==(1080,1350)
        assert output['image']=='original_quote_design'
        assert 'reel' not in output['assets']
    finally:
        shutil.rmtree(OUT/id,ignore_errors=True)

def test_silent_shorts_render():
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        return
    id=str(uuid.uuid4())
    try:
        output=render(RenderRequest(jobId=id,post=sample(),withVideo=True,videoSeconds=5,effectEnabled=False))
        assert 'reel' in output['assets']
        video=OUT/id/'reel.mp4'
        assert video.stat().st_size>2000
        info=subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_type,width,height','-of','csv=p=0',str(video)],text=True)
        assert '720,1280' in info
        assert 'audio' not in info
    finally:
        shutil.rmtree(OUT/id,ignore_errors=True)
