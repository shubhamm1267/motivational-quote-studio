
import { CommonModule } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DEFAULT_API_BASE } from './deploy-config';

type Job = {
  id: string;
  status: 'working' | 'done' | 'failed';
  stage: string;
  progress: number;
  error?: string;
  warnings: string[];
  post?: {
    headline: string;
    detail: string;
    eyebrow: string;
    seoTitle: string;
    caption: string;
    hashtags: string[];
    verification: string;
  };
  assets?: Record<string, string>;
  license?: {
    kind: string;
    creator: string;
    license: string;
    filePage: string;
  };
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);

  // Local Angular dev-server proxies /api and /output to Node.
  apiBase = this.initialApiBase();

  studioAccessKey =
    sessionStorage.getItem('quotecraft-studio-key') || '';

  category = 'all';
  topic = '';
  geminiKey = '';

  model = 'gemini-3.5-flash-lite';

  language = 'en';

  brand =
    localStorage.getItem('quotecraft-brand') || 'Your Page';

  handle =
    localStorage.getItem('quotecraft-handle') || '@yourpage';

  style = 'midnight';
  size = 'portrait';
  withVideo = true;
  videoSeconds = 5;

  effectEnabled = true;
  effectStyle = 'reference';

  iconDataUrl = '';
  iconName = '';

  busy = false;
  historyBusy = false;

  job: Job | null = null;
  history: Job[] = [];

  error = '';
  statusMessage = '';
  galleryError = '';

  timer: ReturnType<typeof setInterval> | undefined;

  copied = '';

  mediaErrors: {
    poster?: string;
    reel?: string;
  } = {};

  categories = [
    { id: 'all', title: 'Mixed Quotes', sub: 'Auto mixed' },
    { id: 'motivation', title: 'Motivation', sub: 'Keep going' },
    { id: 'discipline', title: 'Discipline', sub: 'Habits • focus' },
    { id: 'self', title: 'Self Belief', sub: 'Confidence' },
    { id: 'healing', title: 'Healing', sub: 'Pain • recovery' },
    { id: 'life', title: 'Life', sub: 'Reality • growth' },
    { id: 'attitude', title: 'Attitude', sub: 'Silence • respect' },
    { id: 'success', title: 'Success', sub: 'Work • patience' },
    { id: 'relationships', title: 'Relationships', sub: 'Trust • loyalty' },
    { id: 'breakup', title: 'Breakup', sub: 'Move on' },
    { id: 'friendship', title: 'Friendship', sub: 'True friend' },
    { id: 'family', title: 'Family', sub: 'Support • home' },
    { id: 'comedy', title: 'Life Comedy', sub: 'Funny life' },
    { id: 'sad', title: 'Sad Reality', sub: 'Deep emotion' },
    { id: 'study', title: 'Study', sub: 'Student motivation' }
  ];

  styles = [
    {
      id: 'midnight',
      name: 'Dark Texture',
      class: 'swatch-midnight'
    },
    {
      id: 'editorial',
      name: 'Clean Minimal',
      class: 'swatch-editorial'
    },
    {
      id: 'sunset',
      name: 'Dark Warm',
      class: 'swatch-sunset'
    }
  ];

  private initialApiBase(): string {
    const stored = (
      localStorage.getItem('quotecraft-api-base') || ''
    ).trim().replace(/\/+$/, '');

    // Older versions may contain localhost:3100.
    return /^https?:\/\/(?:localhost|127\.0\.0\.1):3100$/i.test(stored)
      ? DEFAULT_API_BASE
      : (stored || DEFAULT_API_BASE);
  }

  get api(): string {
    return this.apiBase.trim().replace(/\/+$/, '');
  }

  get showResult(): boolean {
    return this.job?.status === 'done';
  }

  asset(name: string, job: Job | null = this.job): string {
    const relative = job?.assets?.[name];

    if (!relative) return '';

    if (relative.startsWith('/')) {
      return `${this.api}${relative}`;
    }

    return relative;
  }

  download(name: string): string {
    const url = this.asset(name);

    return url
      ? url + (url.includes('?') ? '&' : '?') + 'download=1'
      : '';
  }

  get completeCaption(): string {
    const p = this.job?.post;

    return p
      ? `${p.caption}\n\n${(p.hashtags || []).join(' ')}`
      : '';
  }

  ngOnInit(): void {
    void this.loadHistory(true);

    const lastId =
      localStorage.getItem('quotecraft-last-job');

    if (lastId) {
      void this.restorePendingJob(lastId);
    }
  }

  private async restorePendingJob(id: string): Promise<void> {
    try {
      const r = await fetch(`${this.api}/api/jobs/${id}`, {
        cache: 'no-store'
      });

      if (!r.ok) return;

      const j: Job = await r.json();

      if (this.busy || this.job) return;

      this.job = j;
      this.cdr.markForCheck();

      if (j.status === 'working') {
        this.busy = true;
        this.startPolling();
      }
    } catch {
      // Recent gallery loads independently.
    }
  }

  async loadHistory(selectLatest = false): Promise<void> {
    this.historyBusy = true;
    this.galleryError = '';

    try {
      const r = await fetch(
        `${this.api}/api/history?limit=24`,
        { cache: 'no-store' }
      );

      if (!r.ok) {
        throw Error(`History API returned HTTP ${r.status}`);
      }

      const result: { jobs: Job[] } = await r.json();

      this.history = Array.isArray(result.jobs)
        ? result.jobs
        : [];

      if (
        selectLatest &&
        !this.busy &&
        !this.job &&
        this.history.length
      ) {
        this.selectHistory(this.history[0]);
      }

      this.cdr.markForCheck();
    } catch (e) {
      this.galleryError =
        e instanceof Error ? e.message : String(e);
    } finally {
      this.historyBusy = false;
      this.cdr.markForCheck();
    }
  }

  selectHistory(j: Job): void {
    if (this.busy) return;

    this.job = j;
    this.error = '';
    this.mediaErrors = {};

    this.statusMessage = 'Loaded from saved outputs';

    localStorage.setItem('quotecraft-last-job', j.id);

    this.cdr.markForCheck();
  }

  onIconUploaded(event: Event): void {
    const file =
      (event.target as HTMLInputElement).files?.[0];

    if (!file) return;

    if (
      !['image/jpeg', 'image/png', 'image/webp']
        .includes(file.type)
    ) {
      this.error = 'Please select JPG, PNG or WEBP icon';
      return;
    }

    if (file.size > 3_000_000) {
      this.error = 'Icon must be under 3 MB';
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      this.iconDataUrl = String(reader.result);
      this.iconName = file.name;
      this.error = '';
    };

    reader.onerror = () => {
      this.error = 'Could not read icon';
    };

    reader.readAsDataURL(file);
  }

  clearIcon(): void {
    this.iconDataUrl = '';
    this.iconName = '';
  }

  async checkWorker(): Promise<void> {
    try {
      const r = await fetch(`${this.api}/api/health`, {
        cache: 'no-store'
      });

      if (!r.ok) {
        throw Error(`API HTTP ${r.status}`);
      }

      const h = await r.json();

      this.statusMessage = h.worker
        ? 'Node API + Python worker connected'
        : 'Node API online, Python worker offline';

      this.cdr.markForCheck();
    } catch (e) {
      this.statusMessage =
        `Cannot reach API: ${
          e instanceof Error ? e.message : String(e)
        }`;

      this.cdr.markForCheck();
    }
  }

  async generate(): Promise<void> {
    if (this.busy) return;

    this.error = '';
    this.job = null;
    this.mediaErrors = {};
    this.busy = true;

    this.statusMessage = 'Creating job…';

    localStorage.setItem(
      'quotecraft-api-base',
      this.api
    );

    localStorage.setItem(
      'quotecraft-brand',
      this.brand
    );

    localStorage.setItem(
      'quotecraft-handle',
      this.handle
    );

    sessionStorage.setItem(
      'quotecraft-studio-key',
      this.studioAccessKey
    );

    const payload = {
      category: this.category,
      topic: this.topic,
      geminiKey: this.geminiKey,
      model: this.model,
      language: this.language,
      brand: this.brand,
      handle: this.handle,
      style: this.style,
      size: this.size,
      withVideo: this.withVideo,
      videoSeconds: this.videoSeconds,
      effectEnabled: this.effectEnabled,
      effectStyle: this.effectStyle,
      iconDataUrl: this.iconDataUrl
    };

    try {
      const r = await fetch(`${this.api}/api/generate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-studio-key': this.studioAccessKey
        },
        body: JSON.stringify(payload)
      });

      const data = await r.json();

      if (!r.ok) {
        throw Error(
          data.error || `Generate failed (HTTP ${r.status})`
        );
      }

      this.job = {
        id: data.id,
        status: 'working',
        stage: 'Queued',
        progress: 2,
        warnings: []
      };

      this.cdr.markForCheck();

      localStorage.setItem(
        'quotecraft-last-job',
        data.id
      );

      await this.poll();

      if (this.busy) {
        this.startPolling();
      }
    } catch (e) {
      this.error =
        e instanceof Error ? e.message : String(e);

      this.busy = false;
      this.cdr.markForCheck();
    }
  }

  private startPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(
      () => void this.poll(),
      1800
    );
  }

  async poll(): Promise<void> {
    const id = this.job?.id;

    if (!id) return;

    try {
      const r = await fetch(
        `${this.api}/api/jobs/${id}`,
        { cache: 'no-store' }
      );

      if (!r.ok) {
        throw Error(
          `Cannot load job (HTTP ${r.status})`
        );
      }

      const j: Job = await r.json();

      if (this.job?.id !== id) return;

      this.job = j;
      this.statusMessage = j.stage;

      this.cdr.markForCheck();

      if (j.status !== 'working') {
        this.busy = false;

        if (this.timer) {
          clearInterval(this.timer);
        }

        if (j.status === 'failed') {
          this.error = j.error || 'Render failed';
        } else {
          void this.loadHistory(false);
        }
      }
    } catch (e) {
      this.statusMessage =
        `Waiting for renderer: ${
          e instanceof Error ? e.message : String(e)
        }`;

      this.cdr.markForCheck();
    }
  }

  onMediaError(kind: 'poster' | 'reel'): void {
    this.mediaErrors[kind] =
      `${kind === 'poster' ? 'PNG' : 'MP4'} preview could not load. Use Open file or check /api/health.`;

    this.cdr.markForCheck();
  }

  async copy(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);

      this.copied = label;
      this.cdr.markForCheck();

      setTimeout(() => {
        this.copied = '';
        this.cdr.markForCheck();
      }, 2000);
    } catch {
      this.error =
        'Clipboard unavailable; copy manually';
    }
  }

  ngOnDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
