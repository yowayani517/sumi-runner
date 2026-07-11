// 和風サウンドエンジン: 全てWebAudioで合成(外部音源ファイル無し)
// 方針: 初期状態は完全無音。ユーザーがボタンで解禁した時だけ
//       最小音量からゆっくりフェードインする。

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.bgmOn = false;
    this.sfxOn = false;
    this.bgmVol = 0.6; // スライダー値 0..1
    this.sfxVol = 0.8;
    this._bgmTimer = null;
    this._step = 0;
    this._mi = 2; // メロディの現在位置
  }

  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      // コンプレッサーで音圧を稼ぎつつクリップを防ぐ
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 6;
      this.comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = 1.6;
      this.master.connect(this.comp);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0;
      this.bgmGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0;
      this.sfxGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _bgmTarget() { return this.bgmVol * 0.9; }
  _sfxTarget() { return this.sfxVol * 1.3; }

  // ===== ON/OFF (最小音量からリニアに伸ばして上げる) =====
  setBgm(on) {
    this._ensure();
    this.bgmOn = on;
    const g = this.bgmGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (on) {
      g.linearRampToValueAtTime(this._bgmTarget(), t + 2.0); // 小さい音から2秒で育つ
      this._startBgm();
    } else {
      g.linearRampToValueAtTime(0, t + 0.4);
      setTimeout(() => this._stopBgm(), 500);
    }
  }

  setSfx(on) {
    this._ensure();
    this.sfxOn = on;
    const g = this.sfxGain.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(on ? this._sfxTarget() : 0, t + (on ? 1.0 : 0.3));
  }

  // ===== 音量スライダー =====
  setBgmVolume(v) {
    this.bgmVol = v;
    if (this.ctx && this.bgmOn) {
      const g = this.bgmGain.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(this._bgmTarget(), t + 0.15);
    }
  }

  setSfxVolume(v) {
    this.sfxVol = v;
    if (this.ctx && this.sfxOn) {
      const g = this.sfxGain.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(this._sfxTarget(), t + 0.15);
    }
  }

  // ===== 共通部品 =====
  _noiseBuf(dur = 1) {
    const len = Math.ceil(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 琴の爪弾き
  _pluck(freq, t, dest, vol = 0.5, decay = 0.7) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.996, t + decay); // わずかに下がる=弦っぽさ
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq * 6, t);
    f.frequency.exponentialRampToValueAtTime(freq * 1.5, t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(f).connect(g).connect(dest);
    o.start(t); o.stop(t + decay + 0.05);
  }

  // 太鼓
  _taiko(t, vol = 1, dest = null) {
    dest = dest || this.bgmGain;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(105, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.22);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + 0.3);
    // 打面のアタック
    const n = this.ctx.createBufferSource();
    n.buffer = this._noiseBuf(0.05);
    const nf = this.ctx.createBiquadFilter();
    nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 1;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.25 * vol, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(nf).connect(ng).connect(dest);
    n.start(t);
  }

  // ===== BGM: 都節音階の琴+太鼓 =====
  _startBgm() {
    if (this._bgmTimer) return;
    this._nextT = this.ctx.currentTime + 0.1;
    this._step = 0;
    this._bgmTimer = setInterval(() => {
      const ahead = this.ctx.currentTime + 0.9;
      while (this._nextT < ahead) {
        this._playStep(this._step, this._nextT);
        this._nextT += 60 / 84 / 2; // 84bpmの8分音符
        this._step = (this._step + 1) % 64;
      }
    }, 250);
  }

  _stopBgm() {
    if (this._bgmTimer) { clearInterval(this._bgmTimer); this._bgmTimer = null; }
  }

  _playStep(s, t) {
    // 都節音階(A) 2オクターブ
    const scale = [220, 233.08, 293.66, 329.63, 349.23, 440, 466.16, 587.33, 659.26];
    // メロディ: 酔歩+節目で主音へ戻る
    if (s % 2 === 0 || Math.random() < 0.3) {
      if (s % 16 === 0) this._mi = [0, 2, 5][(Math.random() * 3) | 0];
      else this._mi = Math.max(0, Math.min(scale.length - 1, this._mi + [(-2), -1, -1, 1, 1, 2][(Math.random() * 6) | 0]));
      if (Math.random() < 0.8) this._pluck(scale[this._mi], t, this.bgmGain, 0.4, 0.8);
    }
    // 低音の琴(主音ドローン)
    if (s % 8 === 0) this._pluck(110, t, this.bgmGain, 0.3, 1.6);
    // 太鼓: ドン・・・ドドン
    if (s % 16 === 0) this._taiko(t, 1);
    else if (s % 16 === 10) this._taiko(t, 0.55);
    else if (s % 16 === 12) this._taiko(t, 0.7);
  }

  // ===== 効果音 =====
  _sfx(fn) {
    if (!this.sfxOn) return;
    this._ensure();
    fn(this.ctx.currentTime);
  }

  jump() {
    this._sfx(t => {
      const n = this.ctx.createBufferSource();
      n.buffer = this._noiseBuf(0.25);
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 2;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(1600, t + 0.18);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      n.connect(f).connect(g).connect(this.sfxGain);
      n.start(t);
    });
  }

  slide() {
    this._sfx(t => {
      const n = this.ctx.createBufferSource();
      n.buffer = this._noiseBuf(0.4);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(1400, t);
      f.frequency.exponentialRampToValueAtTime(250, t + 0.35);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      n.connect(f).connect(g).connect(this.sfxGain);
      n.start(t);
    });
  }

  coin() {
    this._sfx(t => {
      for (const [f, v, d] of [[2093, 0.35, 0.12], [3136, 0.2, 0.18]]) {
        const o = this.ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(v, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(this.sfxGain);
        o.start(t); o.stop(t + d + 0.02);
      }
    });
  }

  // 必殺技(巻物→竜): 銅鑼+迫り上がる風
  ultimate() {
    this._sfx(t => {
      for (const [f, v] of [[98, 0.8], [147, 0.4], [233, 0.28], [370, 0.18]]) {
        const o = this.ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        o.connect(g).connect(this.sfxGain);
        o.start(t); o.stop(t + 2.3);
      }
      const n = this.ctx.createBufferSource();
      n.buffer = this._noiseBuf(1.6);
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(200, t);
      f.frequency.exponentialRampToValueAtTime(2400, t + 1.4);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
      n.connect(f).connect(g).connect(this.sfxGain);
      n.start(t);
    });
  }

  // お守り発動
  shield() {
    this._sfx(t => {
      for (const [f, dt] of [[1318.5, 0], [1760, 0.07]]) {
        const o = this.ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.4, t + dt);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.5);
        o.connect(g).connect(this.sfxGain);
        o.start(t + dt); o.stop(t + dt + 0.55);
      }
    });
  }

  // 被弾ノックダウン
  knock() {
    this._sfx(t => {
      this._taiko(t, 1.4, this.sfxGain);
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.5);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g).connect(this.sfxGain);
      o.start(t); o.stop(t + 0.6);
    });
  }

  // ベストスコア更新の「ぽおん」
  pon() {
    this._sfx(t => {
      for (const [f, v] of [[880, 0.5], [1320, 0.25], [1760, 0.12]]) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(f * 0.97, t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(v, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        o.connect(g).connect(this.sfxGain);
        o.start(t); o.stop(t + 1.2);
      }
    });
  }

  // 購入音
  buy() {
    this._sfx(t => {
      [523.25, 659.26, 783.99].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = 'triangle'; o.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.3, t + i * 0.07);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.25);
        o.connect(g).connect(this.sfxGain);
        o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.3);
      });
    });
  }
}
