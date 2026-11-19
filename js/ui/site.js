/* Shared site chrome: header navigation and footer, rendered on every page. */
(function () {
  'use strict';
  const REPO = 'https://github.com/RohanRaoCs/ai-escape-room';
  const PAGES = [
    ['index.html', 'Home', 'home'],
    ['simulator.html', 'Simulator', 'simulator'],
    ['benchmark.html', 'Benchmark', 'benchmark'],
    ['learning.html', 'Learning lab', 'learning'],
    ['how-it-works.html', 'How it works', 'how'],
    ['testing.html', 'Testing guide', 'testing'],
  ];
  const current = document.body.dataset.page;

  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML =
    '<a class="site-brand" href="index.html"><span class="mark" aria-hidden="true"></span>UNIT-7 Escape Protocol</a>' +
    '<button class="btn menu-btn" aria-expanded="false" aria-controls="siteNav">Menu</button>' +
    '<nav class="site-nav" id="siteNav" aria-label="Pages">' +
    PAGES.map(([href, label, id]) => `<a href="${href}"${id === current ? ' aria-current="page"' : ''}>${label}</a>`).join('') +
    '</nav>' +
    `<a class="gh" href="${REPO}" target="_blank" rel="noopener">Source on GitHub</a>`;
  document.body.prepend(header);
  const btn = header.querySelector('.menu-btn'), nav = header.querySelector('.site-nav');
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML =
    '<div class="inner">' +
    '<span>An AI escape room: search, constraint satisfaction, behaviour trees, fuzzy logic, a state machine and Q-learning working together.</span>' +
    `<span><a href="testing.html">Testing guide</a> · <a href="${REPO}" target="_blank" rel="noopener">GitHub</a> · <a href="${REPO}/blob/main/REPORT.md" target="_blank" rel="noopener">Report</a></span>` +
    '</div>';
  document.body.appendChild(footer);
})();
