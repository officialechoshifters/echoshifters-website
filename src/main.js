import { Clerk } from '@clerk/clerk-js'
import './style.css'

const app = document.querySelector('#app')
const publishableKey = import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const gaMeasurementId = import.meta.env.VITE_GA_MEASUREMENT_ID

function trackEvent(name, parameters = {}) {
  if (typeof window.gtag === 'function' && gaMeasurementId) window.gtag('event', name, parameters)
}

function showFatal(message) {
  app.innerHTML = `<p style="padding:2rem;color:#f2f3ed;font-family:system-ui;max-width:640px">${message}</p>`
}

if (!publishableKey) {
  console.warn('Clerk is disabled: VITE_CLERK_PUBLISHABLE_KEY is not configured.')
}

let clerk = null

async function loadClerk() {
  if (clerk || !publishableKey) return clerk
  let clerkDomain
  try {
    clerkDomain = atob(publishableKey.split('_')[2]).slice(0, -1)
    if (!clerkDomain) throw new Error('Invalid publishable key')
  } catch {
    console.warn('Invalid Clerk publishable key; authentication is disabled.')
    return null
  }
  try {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`
      script.async = true
      script.crossOrigin = 'anonymous'
      script.onload = resolve
      script.onerror = () => reject(new Error('Failed to load @clerk/ui bundle'))
      document.head.appendChild(script)
    })
    if (!window.__internal_ClerkUICtor) throw new Error('Clerk UI bundle did not register')
    clerk = new Clerk(publishableKey)
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, standardBrowser: true, touchSession: true })
    window.__nigghtersClerk = clerk
    return clerk
  } catch (error) {
    console.warn('Clerk unavailable; authentication is disabled.', error)
    clerk = null
    return null
  }
}

document.querySelector('#app').innerHTML = `
  <header class="topbar"><a class="logo" href="#home" data-search-trigger aria-label="NIGGHTERS home">NIGG<span>H</span>TERS<span class="logo-search" aria-hidden="true">⌕</span></a><button class="search-trigger" data-search-trigger aria-label="Search the journal">⌕</button><button class="menu" aria-label="Toggle navigation" aria-expanded="false">☰</button><nav class="nav"><a href="#page/about">About Us</a><a href="#page/articles">Articles</a><a href="#page/topics">Topics</a><a href="#page/contact" class="touch">Get in Touch</a><a href="#page/newsletter">Newsletter</a><span id="auth-controls"></span></nav></header>
  <main>
    <section id="home" class="hero"><div><div class="eyebrow">Independent curated platform</div><h1>Neural accuracy,<br>pristine <em>facts.</em></h1><p>NIGGHTERS is a quiet place for sharp ideas, thoughtful stories, and the people who keep looking closer.</p><div class="actions"><a class="primary" href="#page/articles">Explore the journal ↗</a><a class="secondary" href="#page/about">About NIGGHTERS</a></div></div><div class="hero-art"><div class="orb"></div><div class="orbit"></div></div></section>
    <div class="ticker"><span><b>✦</b> NEW PERSPECTIVES, WEEKLY</span><span>DESIGNED FOR THE CURIOUS</span><span><b>✦</b> NIGGHTERS / EST. 2026</span></div>
    <section id="about" class="section"><div class="about"><h2>A publication for<br><em>the in-between.</em></h2><div class="about-copy"><p>News moves fast, but accuracy shouldn't be compromised. We track breaking coverage across trusted global publishers, cross-verifying facts as stories unfold.</p></div></div></section>
    <section id="articles" class="section"><div class="section-head"><h2>Top<br><em>news.</em></h2><p class="section-intro">The latest stories from the journal.</p></div><div id="carousel-feed" class="carousel-feed" data-feed="home"><div class="empty"><div class="empty-mark">✦</div><h3>Loading the journal…</h3></div></div><div class="empty" id="article-empty" hidden><div class="empty-mark">✦</div><h3>No articles yet.</h3><p>Our first stories are on their way. Sign in to access the journal when it launches.</p><button class="primary" id="article-auth">Sign in to the journal →</button></div></section>
    <section id="topics" class="section"><div class="section-head"><h2>Follow your<br><em>curiosity.</em></h2><p class="section-intro">Explore the subjects that keep us looking closer.</p></div><div class="topics-grid">${['AI','Business','Culture','Finance','Health','Lifestyle','Politics','Science','Sports','Technology','Environment'].map((topic, index) => `<a class="topic-card" href="#page/topic/${topicToSlug(topic)}"><span class="topic-number">${String(index + 1).padStart(2, '0')}</span><span>${topic}</span><span class="topic-arrow">↗</span></a>`).join('')}</div></section>
    <section id="newsletter" class="section"><div class="newsletter"><div><div class="eyebrow">The weekly dispatch</div><h2>A little light for your inbox.</h2><p>One thoughtful note every week. No noise, no rush — just the good stuff.</p></div><button id="newsletter-action">Join the newsletter →</button></div></section>
    <section id="contact" class="section"><div class="subhero"><div class="eyebrow">Get in touch</div><h1>Let’s make<br><em>contact.</em></h1><p>The NIGGHTERS contact desk is being prepared. Final contact details and an enquiry form will be added here.</p><a class="primary" href="mailto:hello@nigghters.com">Email the desk →</a></div></section>
  </main>
  <footer class="footer"><div class="footer-top"><a class="logo" href="#home">NIGG<span>H</span>TERS</a><div class="footer-links"><a href="#page/about">About Us</a><a href="#page/articles">Articles</a><a href="#page/topics">Topics</a><a href="#page/newsletter">Newsletter</a><a href="#page/contact">Get in Touch</a><a href="#home" data-toast="Terms are coming soon.">Terms</a><a href="#home" data-toast="Privacy information is coming soon.">Privacy</a></div></div><div class="copyright">© 2024 NIGGHTERS. Made for the curious.</div></footer>
  <div id="auth-modal" class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><div class="modal-head"><div><div class="eyebrow">Members area</div><h3 id="auth-title">Create your account</h3></div><button class="close" id="close-auth" aria-label="Close">×</button></div><div class="auth-tabs"><button type="button" class="auth-tab" data-mode="signUp">Sign up</button><button type="button" class="auth-tab" data-mode="signIn">Log in</button></div><div class="modal-body"><div id="clerk-auth"></div></div></div></div>
  <div id="toast" class="toast" hidden></div>
  <div id="search-overlay" class="search-overlay" hidden>
    <div class="search-modal" role="dialog" aria-modal="true" aria-label="Search the journal">
      <div class="search-input-wrap">
        <input id="search-input" class="search-input" type="search" placeholder="Search stories, topics, captions…" autocomplete="off" aria-label="Search">
        <kbd>ESC</kbd>
      </div>
      <div id="search-results" class="search-results"></div>
      <div id="search-count" class="search-count" hidden></div>
    </div>
  </div>
`

const authControls = document.querySelector('#auth-controls')
const modal = document.querySelector('#auth-modal')
const clerkAuthHost = document.querySelector('#clerk-auth')
const authTitle = document.querySelector('#auth-title')
const authTabs = document.querySelectorAll('.auth-tab')
const toast = document.querySelector('#toast')
let savedHomeHTML = document.querySelector('main').innerHTML
let feedView = localStorage.getItem('nigghters-feed-view') === 'list' ? 'list' : 'grid'

function feedToggleHTML() {
  return `<div class="feed-toggle" role="group" aria-label="Article view"><button type="button" data-view="grid" class="${feedView === 'grid' ? 'active' : ''}">Grid</button><button type="button" data-view="list" class="${feedView === 'list' ? 'active' : ''}">List</button></div>`
}

function bindFeedToggle() {
  document.querySelectorAll('.feed-toggle button').forEach((btn) => {
    btn.onclick = () => {
      feedView = btn.dataset.view === 'list' ? 'list' : 'grid'
      localStorage.setItem('nigghters-feed-view', feedView)
      handleRoute()
    }
  })
}

// All journal content (articles, topics, stories, search) is members-only.
function hasAccount() { return Boolean(clerk?.user) }

// Shared members-only screen shown anywhere signed-out visitors hit gated content.
function membersOnlyHTML(reason = 'Journal') {
  return `<section class="page-view"><div class="locked"><div class="empty-mark">✦</div><h1>For members<br><em>only.</em></h1><p class="page-lead">${safeText(reason)} is part of the NIGGHTERS members area. Create a free account to read the full journal, follow topics, and search every story.</p><div class="actions"><button class="primary" data-auth-trigger>Create a free account →</button><a class="secondary" href="#home">Back to home</a></div></div></section>`
}

function renderLockedPage(reason) {
  document.querySelector('main').innerHTML = membersOnlyHTML(reason)
  document.querySelector('[data-auth-trigger]')?.addEventListener('click', () => openAuth())
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function bindHomeButtons() {
  const newsletterBtn = document.querySelector('#newsletter-action')
  if (newsletterBtn) newsletterBtn.onclick = () => clerk?.user ? showToast('Newsletter signups are coming soon. Thanks for being early.') : openAuth()
  const articleAuth = document.querySelector('#article-auth')
  if (articleAuth) articleAuth.onclick = () => openAuth()
}

function renderHome() {
  document.querySelector('main').innerHTML = savedHomeHTML
  bindHomeButtons()
  loadCarouselFeed()
  bindSearchShortcut()
}

function renderAboutPage() {
  document.querySelector('main').innerHTML = `<section class="page-view"><a class="back-link" href="#home">← Back to home</a><div class="eyebrow">About · 001</div><h1>A publication for<br><em>the in-between.</em></h1><p class="page-lead">NIGGHTERS brings together writing, thinking, and visual culture for people who find energy in the hours others overlook. This is the deeper story of what we make and why.</p><div class="stat-row"><div class="stat"><b>2024</b><span>Established</span></div><div class="stat"><b>01</b><span>Weekly dispatch</span></div><div class="stat"><b>10+</b><span>Stories published</span></div></div><div class="value-list"><div class="value-item"><h3>Independent</h3><p>No paywalls, no noise — reporting chosen on merit and curiosity.</p></div><div class="value-item"><h3>Curious</h3><p>Every story starts with a question worth staying up for.</p></div><div class="value-item"><h3>Visual</h3><p>Ideas carried by images, design, and the spaces between words.</p></div></div></section>`
}

const TOPIC_CATALOG = [['AI','Automation, models, and what intelligence means next.'],['Business','How companies and economies work — and how they break.'],['Culture','Visual culture, the work of making, and the ideas shaping how we live together.'],['Finance','Markets, capital flows, and the decisions that move them.'],['Health','Bodies, care, and the science of well-being.'],['Lifestyle','How we spend time, space, and attention.'],['Politics','Power, policy, and the people in between.'],['Science','Discovery, evidence, and the long view.'],['Sports','Competition, culture, and the human limit.'],['Technology','The tools rewriting our routines.'],['Environment','Climate, sustainability, and the planet we share.']]

function topicToSlug(name) {
  return encodeURIComponent(String(name).toLowerCase().replace(/\s+/g, '-'))
}

// Overlay topics were merged (ARTS -> CULTURE, ECONOMY -> BUSINESS, MARKETS ->
// FINANCE), so legacy labels and slugs on pre-merge stories map to their successor.
const TOPIC_LEGACY = { arts: 'Culture', economy: 'Business', markets: 'Finance' }

function displayTopic(topic) {
  const display = { ai: 'AI', crypto: 'Crypto', geopolitics: 'Geopolitics', ...TOPIC_LEGACY }
  const t = String(topic).trim()
  return display[t] || t.charAt(0).toUpperCase() + t.slice(1)
}

function canonicalTopics(carousel) {
  if (!carousel?.topic) return []
  return String(carousel.topic).toLowerCase().split(/[&,/]+/).map((s) => s.trim()).filter(Boolean).map(displayTopic)
}

function buildTopicsData() {
  const counts = new Map()
  ;(window.__nigghtersCarousels || []).forEach((carousel) => canonicalTopics(carousel).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)))
  // The topic list is fixed: only catalog topics are surfaced, so stray categories
  // (e.g. crypto, geopolitics, nature) never appear on the topics page.
  return TOPIC_CATALOG.map(([name, desc]) => ({ name, desc, count: counts.get(name) || 0 }))
}

function renderTopicsPage() {
  if (!hasAccount()) return renderLockedPage('The topic index')
  const topics = buildTopicsData()
  document.querySelector('main').innerHTML = `<section class="page-view"><a class="back-link" href="#home">← Back to home</a><div class="eyebrow">Topics</div><h1>Follow your<br><em>curiosity.</em></h1><p class="page-lead">Every story is filed under a subject. Choose one to open its index of articles.</p><div class="topic-list">${topics.map(({ name, desc, count }, index) => `<a class="topic-row" href="#page/topic/${topicToSlug(name)}"><span class="num">${String(index + 1).padStart(2, '0')}</span><span><b>${name}</b><p class="topic-desc">${desc}${count ? ` · ${count} ${count === 1 ? 'story' : 'stories'}` : ''}</p></span><span class="arr">↗</span></a>`).join('')}</div></section>`
}

function renderNewsletterPage() {
  document.querySelector('main').innerHTML = `<section class="page-view"><a class="back-link" href="#home">← Back to home</a><div class="eyebrow">The weekly dispatch</div><h1>A little light<br>for your <em>inbox.</em></h1><p class="page-lead">One thoughtful note every week — the sharpest story, a visual worth pausing on, and nothing else. No noise, no rush.</p><form class="newsletter-form" id="newsletter-form"><input type="email" placeholder="you@example.com" aria-label="Email address" required><button class="primary" type="submit">Join the dispatch →</button></form></section>
    <section class="updates"><div class="updates-head"><span class="tag">What's new</span><h2>Two things landed.</h2></div><ul class="updates-list"><li><span class="updates-num">01</span><div><h3>Every story now shows its read time.</h3><p>Look for the “3 min read” chip on article cards and the same estimate under each story's headline. It's a rough count from the text on the slides and the caption.</p></div></li><li><span class="updates-num">02</span><div><h3>Search is live across the journal.</h3><p>Press <kbd>Ctrl K</kbd> (or <kbd>⌘ K</kbd>) to search every story by title, topic, or caption. Results rank matches in the headline first, then topics, then the caption.</p></div></li></ul></section>`
  document.querySelector('#newsletter-form').onsubmit = (event) => { event.preventDefault(); showToast('You are on the list — welcome to the dispatch.') }
}

function renderContactPage() {
  document.querySelector('main').innerHTML = `<section class="page-view"><a class="back-link" href="#home">← Back to home</a><div class="eyebrow">Get in touch</div><h1>Let's make<br><em>contact.</em></h1><p class="page-lead">Questions, pitches, partnerships — the NIGGHTERS desk reads everything. Write to us and we will get back within two working days.</p><div class="actions"><a class="primary" href="mailto:hello@nigghters.com">Email the desk →</a></div></section>`
}

function renderArticlesPage() {
  if (!hasAccount()) return renderLockedPage('The journal')
  document.querySelector('main').innerHTML = `<section class="page-view"><a class="back-link" href="#home">← Back to home</a><div class="eyebrow">The journal</div><h1>Top<br><em>news.</em></h1><p class="page-lead">The latest stories from the journal — each one a carousel of frames with the full caption underneath.</p>${feedToggleHTML()}<div id="viewable-feed" class="carousel-feed" data-feed="view"><div class="empty"><div class="empty-mark">✦</div><h3>Loading the journal…</h3></div></div><div class="empty" id="article-empty" hidden><div class="empty-mark">✦</div><h3>No articles yet.</h3><p>Our first stories are on their way.</p><button class="primary" id="article-auth">Sign in to the journal →</button></div></section>`
  bindHomeButtons()
  bindFeedToggle()
  loadCarouselFeed()
}

function handleRoute() {
  const hash = location.hash || '#home'
  if (hash === '#home' || hash === '#') { renderHome(); return }
  // Everything below this line requires an account: articles, topics, stories.
  if (!hasAccount()) {
    if (hash.startsWith('#article/')) return renderLockedPage('That story')
    if (hash === '#page/articles') return renderLockedPage('The journal')
    if (hash === '#page/topics') return renderLockedPage('The topic index')
    if (hash.startsWith('#page/topic/')) return renderLockedPage('That topic')
  }
  if (hash.startsWith('#article/')) {
    if (window.__nigghtersCarousels) openArticle(hash.slice(9))
    return
  }
  const key = hash.slice(1)
  if (key === 'page/about') return renderAboutPage()
  if (key === 'page/topics') return renderTopicsPage()
  if (key.startsWith('page/topic/')) return renderTopicPage(key.slice('page/topic/'.length))
  if (key === 'page/newsletter') return renderNewsletterPage()
  if (key === 'page/contact') return renderContactPage()
  if (key === 'page/articles') return renderArticlesPage()
  renderHome()
}

function readTime(carousel) {
  // The merged index embeds caption_text inline, so this stays synchronous.
  const caption = String(carousel?.caption_text || '')
  const slides = Array.isArray(carousel?.slides) ? carousel.slides : []
  const text = [
    slides.map((s) => s?.text).filter(Boolean),
    caption,
  ].flat().join(' ')
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const perMinute = 200
  const minutes = Math.max(1, Math.round((words || 1) / perMinute))
  return `${minutes} min read`
}

function safeText(value) {
  const el = document.createElement('span')
  el.textContent = value ?? ''
  return el.innerHTML
}

function mediaUrl(file) {
  if (!file) return ''
  const normalized = String(file).replaceAll('\\\\', '/').replace(/^\.\//, '')
  // Absolute URLs (blob stores, CDNs) pass through untouched.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) return normalized
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function articleTitle(carousel) {
  return carousel.slides?.find((slide) => slide.id === 'title_text')?.text || `The late story · ${carousel.id}`
}

function articleImage(slide) {
  const file = mediaUrl(slide?.file)
  if (!file) return ''
  return file.toLowerCase().endsWith('.mp4')
    ? `<video src="${safeText(file)}" muted autoplay loop playsinline></video>`
    : `<img src="${safeText(file)}" alt="${safeText(slide?.text || 'Article slide')}">`
}

const captionCache = new Map()
async function getCaption(carousel) {
  if (captionCache.has(carousel.id)) return captionCache.get(carousel.id)
  // Most index entries embed the caption inline (caption_text); only fall back
  // to a fetch. Static captions come from the gated /content/ endpoint; IG
  // captions live behind the gated /media/ function.
  let caption = ''
  if (carousel.caption_text) {
    caption = carousel.caption_text
  } else {
    try {
      const path = String(carousel.caption || '')
      const url = path.startsWith('/media/') ? mediaUrl(path) : `/content/caption/${encodeURIComponent(carousel.id)}`
      const response = await fetch(url, { headers: { Accept: 'text/plain' } })
      // Accept only real text: dev servers answer unknown paths with the SPA's
      // HTML at status 200, which must not be shown as a caption.
      if (!response.ok || !(response.headers.get('content-type') || '').includes('text/plain')) throw new Error(`no caption for ${carousel.id}`)
      caption = await response.text()
    } catch {
      return 'Caption unavailable for this story.'
    }
  }
  captionCache.set(carousel.id, caption)
  return caption
}

function feedRowHTML(carousel, index) {
  const slides = Array.isArray(carousel.slides) ? carousel.slides : []
  const title = slides[0]?.text || articleTitle(carousel)
  const tags = Array.isArray(carousel.tags) ? carousel.tags : []
  return `<a class="article-row" href="#article/${safeText(carousel.id)}" data-article-id="${safeText(carousel.id)}" data-read-time="${safeText(readTime(carousel))}">
    <span class="row-index">${String(index + 1).padStart(2, '0')}</span>
    <span class="row-main"><h3>${safeText(title)}</h3>${tags.length ? `<div class="carousel-tags">${tags.map((tag) => `<span class="carousel-tag">${safeText(displayTopic(tag))}</span>`).join('')}</div>` : ''}</span>
    <span class="row-meta">${slides.length} frames · ${readTime(carousel)}</span>
    <span class="row-arrow">↗</span>
  </a>`
}

function renderFeedInto(el, carousels, viewable) {
  if (!el) return
  const useList = viewable && feedView === 'list'
  el.className = useList ? 'article-list' : 'carousel-feed'
  el.innerHTML = carousels.length
    ? (useList ? carousels.map(feedRowHTML).join('') : carousels.map(feedCardHTML).join(''))
    : '<div class="empty"><div class="empty-mark">✦</div><h3>Nothing here yet.</h3><p>Stories filed under this topic will appear here.</p></div>'
  bindFeed(el)
}

function feedCardHTML(carousel) {
  const slides = Array.isArray(carousel.slides) ? carousel.slides : []
  const tags = Array.isArray(carousel.tags) ? carousel.tags : []
  const topics = canonicalTopics(carousel)
  if (!topics.length) topics.push(...tags.map((tag) => displayTopic(tag)))
  const chips = topics.length ? `<div class="card-topics">${topics.slice(0, 2).map((topic) => `<span class="cover-topic">${safeText(topic)}</span>`).join('')}</div>` : ''
  const nav = slides.length > 1 ? `<button class="cover-nav left" type="button" aria-label="Previous image">←</button><button class="cover-nav right" type="button" aria-label="Next image">→</button>` : ''
  return `<a class="article-card" href="#article/${safeText(carousel.id)}" data-article-id="${safeText(carousel.id)}" data-read-time="${safeText(readTime(carousel))}">
    ${chips}<div class="article-cover" data-slides="${encodeURIComponent(JSON.stringify(slides.map((s) => s.file).filter(Boolean)))}">${nav}<span class="cover-slide">${articleImage(slides[0] || {})}</span><span class="article-count">${slides.length} frames</span><span class="article-open">Open story ↗</span></div><span class="card-read-time">${readTime(carousel)}</span>
  </a>`
}

function flipCover(cover, dir) {
  if (!cover) return false
  const files = JSON.parse(decodeURIComponent(cover.dataset.slides || '[]'))
  if (!files.length) return false
  const index = (Number(cover.dataset.index || 0) + dir + files.length) % files.length
  cover.dataset.index = index
  cover.querySelector('.cover-slide').innerHTML = articleImage({ file: files[index], text: '' })
  return true
}

function bindCoverSwipe(cover) {
  if (!cover || !('ontouchstart' in window)) return
  let startX = null
  let startY = null
  cover.addEventListener('touchstart', (event) => {
    const touch = event.touches[0]
    startX = touch.clientX
    startY = touch.clientY
  }, { passive: true })
  cover.addEventListener('touchend', (event) => {
    if (startX === null) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY
    startX = null
    startY = null
    // Require a decisive horizontal swipe so vertical page scrolling is never hijacked.
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    cover.dataset.swipedAt = Date.now()
    flipCover(cover, dx < 0 ? 1 : -1)
  }, { passive: true })
}

function bindFeed(feed) {
  if (!feed) return
  feed.querySelectorAll('.article-cover').forEach(bindCoverSwipe)
  feed.onclick = (event) => {
    // A swipe that flipped a cover shouldn't also trigger the card's article link.
    const cover = event.target.closest('.article-cover')
    if (cover && Date.now() - Number(cover.dataset.swipedAt || 0) < 600) {
      event.preventDefault()
      return
    }
    const nav = event.target.closest('.cover-nav')
    if (nav) {
      event.preventDefault()
      flipCover(nav.closest('.article-cover'), nav.classList.contains('left') ? -1 : 1)
      return
    }
    const card = event.target.closest('[data-article-id]')
    if (!card) return
    event.preventDefault()
    trackEvent('article_open', { article_id: card.dataset.articleId })
    location.hash = `article/${card.dataset.articleId}`
  }
}

function renderTopicPage(rawSlug) {
  if (!hasAccount()) return renderLockedPage('That topic')
  const slug = decodeURIComponent(rawSlug || '')
  // Legacy topic slugs (arts/economy/markets) redirect to the topic that absorbed them.
  const topicName = buildTopicsData().find(({ name }) => topicToSlug(name) === slug)?.name || TOPIC_LEGACY[slug]
  const articles = (window.__nigghtersCarousels || []).filter((carousel) => canonicalTopics(carousel).includes(topicName))
  const count = articles.length
  document.querySelector('main').innerHTML = `<section class="page-view"><a class="back-link" href="#page/topics">← All topics</a><div class="eyebrow">Topic index</div><h1>${safeText(topicName || slug)}</h1><p class="page-lead">${count ? `${count} ${count === 1 ? 'story' : 'stories'} filed under ${safeText(topicName)}.` : 'No stories filed under this topic yet — check back soon.'}</p>${feedToggleHTML()}<div id="topic-feed" class="carousel-feed" data-feed="view"></div></section>`
  renderFeedInto(document.querySelector('#topic-feed'), articles, true)
  bindFeedToggle()
}

// fetch JSON but never blow up on HTML/404/dev-server fallbacks; returns
// 'unauthorized' for 401, null for anything unusable, parsed JSON otherwise.
async function fetchJsonSafe(url) {
  try {
    const response = await fetch(url)
    if (response.status === 401) return 'unauthorized'
    if (!response.ok) return null
    const type = response.headers.get('content-type') || ''
    if (!type.includes('json')) return null
    return await response.json()
  } catch {
    return null
  }
}

function renderMembersFeedState() {
  document.querySelectorAll('[data-feed]').forEach((el) => {
    el.innerHTML = `<div class="empty locked-teaser"><div class="empty-mark">✦</div><h3>The journal is for members.</h3><p>Create a free account to read the latest stories.</p><button class="primary" data-auth-trigger>Create a free account →</button></div>`
    el.querySelector('[data-auth-trigger]')?.addEventListener('click', () => openAuth())
  })
}

async function loadCarouselFeed() {
  const feed = document.querySelector('#carousel-feed')
  try {
    // One gated endpoint returns the merged index (static + Instagram, IG
    // first). The server only answers for verified Clerk sessions.
    let data = await fetchJsonSafe('/content/carousels/index.json')
    if (data === 'unauthorized') {
      renderMembersFeedState()
      return
    }
    if (!data) {
      // Dev fallback: plain `vite` has no Netlify functions, so the gated
      // endpoint doesn't exist. Read the static files directly (they still
      // exist in public/ during dev; production strips them and has /content).
      const [staticData, igData] = await Promise.all([
        fetchJsonSafe('/carousels/index.json'),
        fetchJsonSafe('/media/index.json'),
      ])
      const staticCarousels = staticData && Array.isArray(staticData.carousels) ? staticData.carousels : []
      const igCarousels = igData && Array.isArray(igData.carousels) ? igData.carousels : []
      const seen = new Set()
      data = { carousels: [...igCarousels, ...staticCarousels].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))) }
    }
    const carousels = Array.isArray(data.carousels) ? data.carousels : []
    // The dev fallback bypasses the server gate, so enforce the client gate
    // here too — signed-out visitors see the teaser, never the feed.
    if (!hasAccount()) {
      renderMembersFeedState()
      return
    }
    // IG-synced entries live under /media/...; the poller diffs just those.
    __nigghtersIgIds = new Set(carousels.filter((c) => String(c.directory || '').startsWith('/media/')).map((c) => c.id))
    if (!carousels.length) throw new Error('No carousel data')
    window.__nigghtersCarousels = carousels
    window.__nigghtersGetCaption = getCaption
    // A 401 never reaches here (early return), so anyone rendering the feed is
    // signed in — the server already checked the Clerk session.
    document.querySelectorAll('[data-feed]').forEach((el) => renderFeedInto(el, el.dataset.feed === 'home' ? carousels.slice(0, 6) : carousels, el.dataset.feed === 'view'))
    refreshSearchIndex()
  } catch (error) {
    if (feed) feed.innerHTML = ''
    const empty = document.querySelector('#article-empty')
    if (empty) empty.hidden = false
    console.warn('Could not load carousel feed', error)
  }
}

// Poll the live index so new Instagram posts appear without a manual refresh.
// Skips while a story is open so readers are never interrupted.
let __nigghtersIgIds = new Set()
let __nigghtersSearchIndex = []
let __nigghtersSearchVisible = false
const searchOverlay = document.querySelector('#search-overlay')
const searchInput = document.querySelector('#search-input')
const searchResults = document.querySelector('#search-results')
const searchCount = document.querySelector('#search-count')
let searchActiveIndex = -1

function refreshSearchIndex() {
  const carousels = window.__nigghtersCarousels || []
  __nigghtersSearchIndex = carousels.map((carousel) => {
    const slides = Array.isArray(carousel.slides) ? carousel.slides : []
    const title = slides.find((s) => s.id === 'title_text')?.text || carousel.id
    const topics = canonicalTopics(carousel)
    const caption = String(carousel.caption_text || '')
    return {
      id: carousel.id,
      title: String(title || '').trim(),
      topics: topics.map(String).join(' '),
      caption: String(caption || '').trim(),
      captionLoading: !carousel.caption,
    }
  })
}

function openSearch() {
  if (!hasAccount()) { showToast('Sign in to search the journal.'); openAuth(); return }
  if (!searchOverlay) return
  __nigghtersSearchVisible = true
  searchOverlay.hidden = false
  searchInput.value = ''
  searchActiveIndex = -1
  searchResults.innerHTML = ''
  searchCount.hidden = true
  refreshSearchIndex()
  window.scrollTo({ top: 0, behavior: 'instant' })
  setTimeout(() => searchInput?.focus(), 0)
}

function closeSearch() {
  __nigghtersSearchVisible = false
  searchOverlay.hidden = true
  searchInput.blur()
}

function normalizeQuery(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function searchIndex(text) {
  const query = normalizeQuery(text)
  if (!query) return []
  const queryWords = query.split(/\s+/).filter(Boolean)
  return __nigghtersSearchIndex
    .map((item) => {
      const haystack = `${item.title} ${item.topics} ${item.caption}`.toLowerCase()
      let score = 0
      for (const word of queryWords) {
        if (!word) continue
        if (item.title.toLowerCase().includes(word)) score += 3
        if (item.topics.toLowerCase().includes(word)) score += 2
        if (item.caption.toLowerCase().includes(word)) score += 1
      }
      const matchAtStart = item.title.toLowerCase().startsWith(query) ? 2 : 0
      return { item, score: score + matchAtStart }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item)
}

function snippet(text, query, max = 90) {
  if (!text) return ''
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  const start = idx >= 0 ? Math.max(0, idx - 25) : 0
  const end = start + max + 40
  let s = text.slice(start, end)
  if (start > 0) s = '…' + s
  if (end < text.length) s = s + '…'
  return s
}

function renderSearchResults(query) {
  if (!query || !normalizeQuery(query)) {
    searchResults.innerHTML = ''
    searchCount.hidden = true
    searchActiveIndex = -1
    return
  }
  const matches = searchIndex(query)
  if (!matches.length) {
    searchResults.innerHTML = '<div class="search-empty">No stories match “' + safeText(normalizeQuery(query)) + '”.</div>'
    searchCount.hidden = true
    searchActiveIndex = -1
    return
  }
  searchCount.hidden = false
  searchCount.textContent = `${matches.length} result${matches.length === 1 ? '' : 's'} for “${safeText(normalizeQuery(query))}”`
  searchActiveIndex = -1
  searchResults.innerHTML = matches
    .map((item, i) => {
      const slug = topicToSlug(item.topics.split(' ')[0]) || 'articles'
      return `<a class="search-result" href="#article/${safeText(item.id)}" data-search-result="${i}">
        <h3>${safeText(item.title)}</h3>
        <div class="search-result-meta">${safeText(item.topics || 'Journal')}</div>
        <div class="search-result-snippet">${safeText(snippet(item.caption || item.title, normalizeQuery(query)))}</div>
      </a>`
    })
    .join('')
}

function navigateSearchResult(delta) {
  const items = searchResults.querySelectorAll('[data-search-result]')
  if (!items.length) return
  searchActiveIndex = (searchActiveIndex + delta + items.length) % items.length
  items.forEach((el, i) => el.classList.toggle('active', i === searchActiveIndex))
  const target = items[searchActiveIndex]
  if (target) {
    target.scrollIntoView({ block: 'nearest' })
    target.focus({ preventScroll: true })
  }
}

function bindSearchShortcut() {
  document.removeEventListener('keydown', searchKeyHandler)
  document.addEventListener('keydown', searchKeyHandler)
}

function searchKeyHandler(event) {
  const cmdOrCtrl = event.metaKey || event.ctrlKey
  if (cmdOrCtrl && event.key === 'k') {
    event.preventDefault()
    if (!__nigghtersSearchVisible) openSearch()
    return
  }
  if (!__nigghtersSearchVisible) return
  if (event.key === 'Escape') { closeSearch(); return }
  if (event.key === 'ArrowDown') { event.preventDefault(); navigateSearchResult(1); return }
  if (event.key === 'ArrowUp') { event.preventDefault(); navigateSearchResult(-1); return }
  if (event.key === 'Enter') {
    const active = searchResults.querySelector('[data-search-result].active')
    if (active) { active.click(); closeSearch() }
    else if (searchActiveIndex >= 0) { const items = searchResults.querySelectorAll('[data-search-result]'); const target = items[searchActiveIndex]; if (target) { target.click(); closeSearch() } }
    return
  }
}

searchInput?.addEventListener('input', (e) => renderSearchResults(e.target.value))
searchResults?.addEventListener('click', (e) => {
  const link = e.target.closest('[data-search-result]')
  if (!link) return
  closeSearch()
  trackEvent('search_result_open', { query: searchInput.value, article_id: link.getAttribute('href')?.slice(9) || '' })
})
async function pollInstagramFeed() {
  try {
    const hash = location.hash || '#home'
    const isFeedView = hash === '#' || hash === '#home' || hash.startsWith('#page/articles')
    const data = await fetchJsonSafe('/content/media/index.json')
    if (!data || !Array.isArray(data.carousels)) return
    const carousels = data.carousels
    if (!carousels.length) return
    const ids = new Set(carousels.map((c) => c.id))
    const unchanged = ids.size === __nigghtersIgIds.size && [...ids].every((id) => __nigghtersIgIds.has(id))
    __nigghtersIgIds = ids
    if (unchanged) return
    if (!isFeedView) return
    await loadCarouselFeed()
  } catch {
    // Swallow transient failures; the next poll retries.
  }
}
setInterval(pollInstagramFeed, 60_000)

let activeStory = null

function goToStory(dir) {
  const state = activeStory
  if (!state || typeof state.render !== 'function') return
  state.index = (state.index + dir + state.slides.length) % state.slides.length
  trackEvent('carousel_slide_change', { article_id: state.id, slide_index: state.index + 1 })
  state.render()
}

function bindStorySwipe(el, onSwipe) {
  if (!el || !('ontouchstart' in window)) return
  let startX = null
  let startY = null
  el.addEventListener('touchstart', (event) => {
    const touch = event.touches[0]
    startX = touch.clientX
    startY = touch.clientY
  }, { passive: true })
  el.addEventListener('touchend', (event) => {
    if (startX === null) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - startX
    const dy = touch.clientY - startY
    startX = null
    startY = null
    // Only a decisive horizontal swipe changes slides; vertical scrolling stays native.
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return
    onSwipe(dx < 0 ? 1 : -1)
  }, { passive: true })
}

async function openArticle(id) {
  if (!hasAccount()) return renderLockedPage('That story')
  const carousel = window.__nigghtersCarousels?.find((item) => item.id === id)
  if (!carousel) return
  const slides = (carousel.slides || []).filter((slide) => slide?.file)
  if (!slides.length) return
  const title = articleTitle(carousel)
  const caption = await getCaption(carousel)
  const script = slides.filter((slide) => slide.text && slide.text.trim()).map((slide, index) => `<li><span class="script-index">${String(index + 1).padStart(2, '0')}</span><p>${safeText(slide.text)}</p></li>`).join('')
  document.querySelector('main').innerHTML = `<section class="article-detail"><a class="back-link" href="#page/articles">← Back to journal</a><div class="detail-heading"><div><div class="eyebrow">Journal · ${safeText(carousel.id)}</div><h1>${safeText(title)}</h1><span class="detail-read-time">${readTime(carousel)}</span></div><span class="detail-index">01 / ${String(slides.length).padStart(2, '0')}</span></div><div class="story-layout"><aside class="caption-panel"><div><div class="eyebrow">Instagram caption</div><h2>The story in full.</h2></div><p id="detail-caption">${safeText(caption)}</p></aside><div class="story-visual"><div class="story-carousel"><button class="carousel-control prev" aria-label="Previous slide">←</button><div class="story-stage"></div><button class="carousel-control next" aria-label="Next slide">→</button></div><div class="story-meta"><span id="story-progress">01 / ${String(slides.length).padStart(2, '0')}</span><span>Swipe or use the arrows to explore</span></div>${script ? `<div class="story-script"><div class="eyebrow">On the slides</div><ol>${script}</ol></div>` : ''}</div></div></section>`
  activeStory = { id: carousel.id, slides, index: 0 }
  const stage = document.querySelector('.story-stage')
  const progress = document.querySelector('#story-progress')
  activeStory.render = () => {
    const slide = slides[activeStory.index] || {}
    stage.innerHTML = `${articleImage(slide)}<div class="slide-label">${String(activeStory.index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</div>`
    progress.textContent = `${String(activeStory.index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`
  }
  document.querySelector('.prev').onclick = () => goToStory(-1)
  document.querySelector('.next').onclick = () => goToStory(1)
  bindStorySwipe(stage, (dir) => goToStory(dir))
  activeStory.render()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

window.addEventListener('hashchange', () => { if (__nigghtersSearchVisible) closeSearch(); handleRoute() })
bindHomeButtons()
loadCarouselFeed().then(() => handleRoute())

let authMode = localStorage.getItem('nigghters-auth-mode') || 'signUp'
const AUTH_LABELS = {
  signUp: { title: 'Create your account', note: 'New here? It only takes a minute.' },
  signIn: { title: 'Welcome back', note: 'Log in to keep reading.' },
}

const authAppearance = {
  variables: {
    colorPrimary: '#007F7C',
    colorTextOnPrimary: '#f0fffd',
    colorBackground: '#151a18',
    colorInputBackground: '#0f1312',
    colorInputText: '#f2f3ed',
    colorText: '#f2f3ed',
    colorTextSecondary: '#9da7a2',
    colorDanger: '#ff7a6e',
    colorSuccess: '#3fcfae',
    colorAlphaShade: '#050707cc',
    colorBorder: '#2b4a47',
    borderRadius: '0.5rem',
    fontSize: '14px',
    fontFamily: "'Manrope','Segoe UI',system-ui,sans-serif",
  },
  elements: {
    card: { background: 'transparent', boxShadow: 'none', border: 'none' },
    header: { padding: '0 0 1.1rem' },
    headerTitle: { color: '#f2f3ed', fontSize: '1.2rem', margin: 0, fontFamily: "'Playfair Display','Georgia',serif", fontWeight: 500 },
    headerSubtitle: { color: '#9da7a2' },
    formButtonPrimary: { background: '#007F7C', color: '#f0fffd', fontWeight: 700, borderRadius: '0.5rem', ':hover': { background: '#0a918c' }, ':focus': { boxShadow: '0 0 0 3px #2fc9c366' } },
    formFieldInput: { background: '#0f1312', border: '1px solid #2b4a47', borderRadius: '0.5rem', color: '#f2f3ed', ':hover': { borderColor: '#3f7b76' }, ':focus': { borderColor: '#2fc9c3' } },
    formFieldLabel: { color: '#bac1bd' },
    dividerLine: { background: '#2b4a47' },
    dividerText: { color: '#68716c' },
    socialButtonsBlockButton: { background: '#0f1312', border: '1px solid #2b4a47', color: '#f2f3ed', borderRadius: '0.5rem' },
    formHintText: { color: '#68716c', fontSize: '12px' },
    formFieldErrorText: { color: '#ff7a6e' },
  },
}

let clerkAuthEl = null

function unmountAuth() {
  const host = clerkAuthHost
  if (!clerk) { host.replaceChildren(); return }
  if (clerkAuthEl) {
    try { clerk.unmountSignUp(clerkAuthEl) } catch { /* noop */ }
    try { clerk.unmountSignIn(clerkAuthEl) } catch { /* noop */ }
    clerkAuthEl = null
  }
  host.replaceChildren()
}

function setAuthMode(mode, persist = true) {
  authMode = mode
  if (!clerk) { showToast('Member sign-in will be available soon.'); return }
  if (persist) localStorage.setItem('nigghters-auth-mode', mode)
  authTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode))
  authTitle.textContent = AUTH_LABELS[mode].title
  unmountAuth()
  // Mount into a fresh container that we never mutate while Clerk controls it.
  clerkAuthEl = document.createElement('div')
  clerkAuthHost.appendChild(clerkAuthEl)
  const props = { appearance: authAppearance }
  try {
    if (mode === 'signUp') {
      clerk.mountSignUp(clerkAuthEl, props)
    } else {
      clerk.mountSignIn(clerkAuthEl, props)
    }
  } catch (error) {
    clerkAuthEl = null
    clerkAuthHost.replaceChildren()
    const err = document.createElement('p')
    err.className = 'auth-error'
    err.textContent = `Could not load the form: ${error?.message || error}`
    clerkAuthHost.appendChild(err)
    console.error(error)
  }
}

function renderAuth() {
  authControls.innerHTML = ''
  if (!clerk) { const button = document.createElement('button'); button.className = 'auth-link'; button.textContent = 'Members'; button.onclick = () => openAuth(); authControls.appendChild(button); return }
  if (clerk.user) {
    const userButton = document.createElement('div')
    authControls.appendChild(userButton)
    clerk.mountUserButton(userButton)
  } else {
    const button = document.createElement('button')
    button.className = 'auth-link'
    button.textContent = 'Log In / Sign Up'
    button.onclick = () => openAuth()
    authControls.appendChild(button)
    // The Clerk team's sign-up also has an internal "Already have an account? Sign in" link,
    // which can navigate oddly inside a modal. Our tabs handle both directions cleanly, so the
    // whole flow stays inside the same popup and never leaves the page.
    const switchHint = document.createElement('p')
    switchHint.className = 'auth-switch-hint'
    switchHint.textContent = "New here? You'll get the sign-up form first."
    authControls.appendChild(switchHint)
  }
}

async function openAuth(mode) {
  const loadedClerk = await loadClerk()
  if (!loadedClerk) { showToast('Member sign-in is unavailable right now.'); return }
  setAuthMode(mode ?? authMode)
  modal.classList.add('show')
}

function closeAuth() {
  unmountAuth()
  modal.classList.remove('show')
}

let toastTimer
function showToast(message) {
  toast.textContent = message
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.hidden = true }, 3400)
}

renderAuth()
loadClerk().then((loadedClerk) => { if (loadedClerk) { renderAuth(); loadedClerk.addListener(({ user }) => { if (user) closeAuth(); renderAuth(); handleRoute() }) } })
authTabs.forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.mode)))
document.querySelector('#close-auth').onclick = closeAuth
modal.onclick = (event) => { if (event.target === modal) closeAuth() }
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && modal.classList.contains('show')) closeAuth() })
document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  if (modal.classList.contains('show')) return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return
  if (!document.querySelector('.story-carousel')) return
  event.preventDefault()
  goToStory(event.key === 'ArrowRight' ? 1 : -1)
})
document.querySelector('#article-auth').onclick = () => openAuth()
document.querySelector('#newsletter-action').onclick = () => clerk?.user ? showToast('Newsletter signups are coming soon. Thanks for being early.') : openAuth()
document.querySelectorAll('[data-search-trigger]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); openSearch() })); document.querySelector('.menu').onclick = () => { const nav = document.querySelector('.nav'); const open = nav.classList.toggle('open'); document.querySelector('.menu').setAttribute('aria-expanded', String(open)) }
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]')
  if (link) document.querySelector('.nav').classList.remove('open')
  const toastLink = event.target.closest('[data-toast]')
  if (toastLink) { event.preventDefault(); showToast(toastLink.dataset.toast) }
  if (searchOverlay && __nigghtersSearchVisible && !searchOverlay.contains(event.target) && !event.target.closest('[data-search-trigger]')) closeSearch()
})
