/* Full lesson card approved on 26 November 2026. */
(() => {
  'use strict';
  const URL = 'https://www.youtube.com/watch?v=OtuEMgYaU30';
  const CARD = `<section class="full-lesson-card" aria-labelledby="full-lesson-title">
  <a class="full-lesson-poster" href="https://www.youtube.com/watch?v=OtuEMgYaU30" data-full-breaststroke-lesson target="_blank" rel="noopener noreferrer" aria-label="Смотреть полный урок Брасс с нуля на YouTube, 18 минут 17 секунд">
    <img src="lesson-breaststroke-youtube.jpg?v=1" alt="Брасс с нуля — полный урок Плавательного острова VIP" width="1672" height="941">
    <span class="full-lesson-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5Z"/></svg></span>
    <span class="full-lesson-duration" aria-hidden="true">18:17</span>
  </a>
  <div class="full-lesson-content">
    <div class="full-lesson-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z"/></svg>ПОЛНЫЙ ВИДЕОУРОК</div>
    <h3 class="full-lesson-heading" id="full-lesson-title">Брасс с нуля: полный урок</h3>
    <p class="full-lesson-description">Дыхание, работа рук и ног, скольжение и полный цикл — в одном видео.</p>
    <a class="full-lesson-cta" href="https://www.youtube.com/watch?v=OtuEMgYaU30" data-full-breaststroke-lesson target="_blank" rel="noopener noreferrer">Смотреть на YouTube<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M10 5H5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-5"/></svg></a>
    <p class="full-lesson-author">С Ярославом Пахомовым · откроется в YouTube</p>
  </div>
</section>`;
  window.BreaststrokeFullLesson = Object.freeze({
    render: route => route === 'br0' ? CARD : '',
  });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[data-full-breaststroke-lesson]') : null;
    if (!link || link.href !== URL || typeof window.openExt !== 'function') return;
    event.preventDefault();
    window.openExt(URL);
  });
})();
