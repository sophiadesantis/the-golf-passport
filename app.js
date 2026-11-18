import {normalizeCourse, normalizeBucket, moveCourse, validateBackup, loadProfiles, saveProfile, deleteProfile, ACTIVE_PROFILE_KEY} from './data.js';
import {getSession, cloudSave, cloudLoad, cloudDelete} from './cloud.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const escape = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
const icon = (name, cls = '') => {
  const paths = {plus:'M12 5v14M5 12h14',search:'m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',flag:'M5 21V3m0 1c5-4 9 4 14 0v9c-5 4-9-4-14 0',pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',close:'m6 6 12 12M6 18 18 6',check:'m5 12 4 4L19 6',camera:'M4 7h4l2-3h4l2 3h4v13H4Z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',grip:'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',up:'m6 14 6-6 6 6',down:'m6 10 6 6 6-6',edit:'m16 3 5 5-13 13H3v-5Z M13 6l5 5',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',book:'M12 5c-3-3-8-2-10-1v15c3-1 7-2 10 1 3-3 7-2 10-1V4c-3-1-7-2-10 1Zm0 0v15',image:'M3 3h18v18H3Z m0 14 5-5 4 4 3-3 6 6M17 8h.01',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',cloud:'M7 18a5 5 0 0 1-1-10 6 6 0 0 1 11-2 6 6 0 0 1 1 12',logout:'M9 3H3v18h6M12 12h9m-4-4 4 4-4 4',star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z'};
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.flag}"/></svg>`;
};
let profile = null, profiles = [], mode = 'loading', user = null, revision = null;
let search = '', sort = 'rank', modal = null, draft = null, lastFocus = null, pendingAction = null, drag = null, toastTimer;
let busy = false;
const empty = () => ({courses:[],bucket:[]});
const current = () => profile || empty();
const toast = (message, action) => {
  clearTimeout(toastTimer); const el = $('#toast');
  el.innerHTML = `${icon('check')}<span>${escape(message)}</span>${action ? `<button data-action="${action}">Undo</button>`:''}`;
  el.classList.add('visible'); toastTimer = setTimeout(()=>el.classList.remove('visible'),5500);
};
const stars = (rating) => `<span class="stars" aria-label="${rating} out of 5 stars"><span aria-hidden="true">★★★★★</span><span class="stars-fill" style="width:${rating / 5 * 100}%" aria-hidden="true">★★★★★</span></span>`;
function formatDate(value) { return value ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'}).format(new Date(value+'T12:00:00')) : 'Date not added'; }
function initials(name) {return name?.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'GP';}
function isRankable() {return sort === 'rank' && !search.trim();}
function displayedCourses() {
  const query = search.toLowerCase().trim();
  const courses = current().courses.filter(c=>`${c.name} ${c.location} ${c.comments} ${c.favoriteHoles}`.toLowerCase().includes(query));
  if (sort === 'rating') courses.sort((a,b)=>b.rating-a.rating);
  if (sort === 'recent') courses.sort((a,b)=>(b.playedAt || b.createdAt).localeCompare(a.playedAt || a.createdAt));
  if (sort === 'name') courses.sort((a,b)=>a.name.localeCompare(b.name));
  return courses;
}
function render() {
  const {courses,bucket} = current();
  const average = courses.length ? (courses.reduce((n,c)=>n+c.rating,0)/courses.length).toFixed(1) : '—';
  const photos = courses.reduce((n,c)=>n+c.photos.length,0);
  $('#app').innerHTML = `
  <header class="site-header"><div class="header-inner">
    <a class="brand" href="#" aria-label="The Golf Passport home"><span class="brand-mark">${icon('flag')}</span><span>the golf<span class="brand-bottom">passport<span class="brand-dot">.</span></span></span></a>
    <nav aria-label="Main navigation"><button class="nav-link active" data-action="home">My passport</button><button class="nav-link" data-action="album">Photo album <span class="nav-count">${photos}</span></button></nav>
    <button class="profile-button" data-action="account"><span class="avatar">${profile ? escape(initials(profile.name)):icon('book')}</span><span>${profile ? escape(profile.name) : user ? 'Start my passport' : 'Sign in'}<small>${mode==='cloud' && user ? 'Synced passport' : mode==='local' ? 'Local preview' : 'Your golf story starts here'}</small></span>${icon('down')}</button>
  </div></header>
  <main id="main">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy"><div class="eyebrow"><span class="mini-ball"></span> FOR THE LOVE OF THE GAME</div><h1 id="hero-title">Great rounds.<br>Even better <em>memories.</em></h1><p>Your favorite fairways. Your someday courses.<br>A little passport for a lifetime of golf.</p><button class="button lime" data-action="add-course">${icon('plus')} Log a round</button><span class="hero-handwritten">Make every course count.</span></div>
      <div class="hero-art"><img src="./assets/hero-course.svg" alt="A sunny golf course with rolling green fairways, a lake, and a flag"/><div class="hero-stamp"><span>THE GOLF PASSPORT</span>${icon('flag')}<strong>Good days<br>start on the green.</strong><small>EST. FOR YOUR NEXT ROUND</small></div></div>
    </section>
    <section class="passport-heading"><div><div class="eyebrow green">YOUR PERSONAL CLUBHOUSE</div><h2>${profile ? `${escape(profile.name.split(' ')[0])}’s passport` : 'Your golf story, all in one place.'}</h2></div><div class="save-status">${icon(mode==='cloud'?'cloud':'book')}<span>${mode==='cloud' && profile ? 'Saved to your account' : mode==='loading' ? 'Opening your passport…' : mode==='local' && profile ? 'Saved on this browser' : mode==='error' ? 'Connection unavailable · reload to retry' : 'Sign in to sync across devices'}</span></div></section>
    <section class="stats" aria-label="Passport statistics"><div><span class="stat-icon mint">${icon('flag')}</span><span><strong>${courses.length.toString().padStart(2,'0')}</strong><small>Courses played</small></span></div><div><span class="stat-icon yellow">${icon('pin')}</span><span><strong>${bucket.length.toString().padStart(2,'0')}</strong><small>On the bucket list</small></span></div><div><span class="stat-icon peach">${icon('star')}</span><span><strong>${average}<em> / 5</em></strong><small>Average course rating</small></span></div><div><span class="stat-icon blue">${icon('camera')}</span><span><strong>${photos.toString().padStart(2,'0')}</strong><small>Memories captured</small></span></div></section>
    <div class="list-layout">
      <section class="played-section" aria-labelledby="played-title"><div class="section-heading"><div><span class="section-kicker">BEEN THERE. PLAYED THAT.</span><h2 id="played-title">Courses played <span>${courses.length}</span></h2></div><button class="button dark small" data-action="add-course">${icon('plus')} Update</button></div>
        <div class="list-toolbar"><label class="search-field">${icon('search')}<input id="course-search" type="search" value="${escape(search)}" placeholder="Find a course or a memory" aria-label="Search courses played"/></label><label class="sort-field"><span class="sr-only">Sort courses</span><select id="sort"><option value="rank" ${sort==='rank'?'selected':''}>My ranking</option><option value="rating" ${sort==='rating'?'selected':''}>Highest rated</option><option value="recent" ${sort==='recent'?'selected':''}>Most recent</option><option value="name" ${sort==='name'?'selected':''}>Course name</option></select>${icon('down')}</label></div>
        <div id="course-list">${courseListHTML()}</div>
        ${courses.length > 1 ? `<p class="list-hint">${icon('grip')} ${isRankable() ? 'Drag your cards to rank your favorites. Use the chevrons for keyboard controls.' : 'Choose “My ranking” and clear search to reorder courses.'}</p>`:''}
      </section>
      <aside class="bucket-section" aria-labelledby="bucket-title"><div class="section-heading"><div><span class="section-kicker">A LITTLE DAYDREAMING</span><h2 id="bucket-title">Bucket list <span>${bucket.length}</span></h2></div><button class="button outline small" data-action="add-bucket">${icon('plus')} Update</button></div><div class="bucket-card"><div class="bucket-note">Big dreams. Beautiful fairways.<span>Check a course off when you’ve played it.</span></div><div id="bucket-list">${bucketHTML()}</div><button class="bucket-add" data-action="add-bucket">${icon('plus')} Add a someday course</button></div><div class="quote-card"><span class="quote-spark">✳</span><p>There’s always<br>another great<br><em>round ahead.</em></p><span class="quote-line"></span><small>KEEP EXPLORING. KEEP PLAYING.</small></div></aside>
    </div>
    <section class="bottom-banner"><span class="ball-big"></span><div><h3>Scores fade. The stories stay.</h3><p>Add your photos, your favorite holes, and the little things worth remembering.</p></div><button class="button white" data-action="add-course">${icon('book')} Save a memory</button></section>
  </main><footer><span class="footer-brand">the golf passport.</span><span>A lifetime of golf. One course at a time.</span><button data-action="settings">Privacy &amp; your data</button></footer>`;
}
function courseListHTML() {
  const courses = displayedCourses();
  if (!courses.length) return `<div class="empty-state"><img src="./assets/empty-played.svg" alt=""/><h3>${search ? 'No courses in this corner of the green.' : 'Your first fairway is waiting.'}</h3><p>${search ? 'Try another course name, location, or memory.' : 'Log a course you’ve played. Add the score,<br>the stories, and a photo or two.'}</p><button class="button dark" data-action="${search?'clear-search':'add-course'}">${icon(search?'search':'plus')}${search?'Clear search':'Log your first round'}</button></div>`;
  return courses.map(c=>{const index=current().courses.findIndex(x=>x.id===c.id);return `<article class="course-card" data-course="${escape(c.id)}" ${isRankable()?'draggable="true"':''}><div class="course-cover ${c.photos[0]?'has-photo':''}">${c.photos[0]?`<img src="${c.photos[0].dataUrl}" alt="${escape(c.name)}" loading="lazy"/>`:`<img src="./assets/hero-course.svg" alt="" class="course-illustration"/>`}<span class="rank-badge" aria-label="Rank ${index+1}">#${index+1}</span>${c.photos.length?`<button class="photo-count" data-action="view" data-id="${escape(c.id)}" aria-label="View ${c.photos.length} photos of ${escape(c.name)}">${icon('camera')}${c.photos.length}</button>`:''}</div><div class="course-info"><div class="course-topline"><span class="course-location">${icon('pin')}${escape(c.location || 'Your golfing memories')}</span><button class="icon-button edit-course" data-action="edit-course" data-id="${escape(c.id)}" aria-label="Edit ${escape(c.name)}">${icon('edit')}</button></div><button class="course-name" data-action="view" data-id="${escape(c.id)}">${escape(c.name)}</button><div class="rating-row">${stars(c.rating)}<span>${c.rating.toFixed(1)}</span><span class="date-label">${formatDate(c.playedAt)}</span></div><div class="round-details"><span><small>SHOT</small><strong>${escape(c.score || '—')}</strong></span><span><small>FAVORITE HOLE${c.favoriteHoles.includes(',')?'S':''}</small><strong>${escape(c.favoriteHoles || '—')}</strong></span></div>${c.comments?`<p class="course-comment">“${escape(c.comments)}”</p>`:''}<div class="course-actions"><button data-action="view" data-id="${escape(c.id)}">View memory</button>${isRankable()?`<span class="rank-controls"><button class="icon-button" data-action="rank-up" data-id="${escape(c.id)}" aria-label="Move ${escape(c.name)} up" ${index===0?'disabled':''}>${icon('up')}</button>${icon('grip')}<button class="icon-button" data-action="rank-down" data-id="${escape(c.id)}" aria-label="Move ${escape(c.name)} down" ${index===current().courses.length-1?'disabled':''}>${icon('down')}</button></span>`:''}</div></div></article>`}).join('');
}
function bucketHTML() {
  const bucket = current().bucket;
  if (!bucket.length) return `<div class="empty-bucket"><img src="./assets/empty-bucket.svg" alt=""/><h3>Where to next?</h3><p>That course you can’t stop thinking<br>about? Put it on the list.</p></div>`;
  return bucket.map(c=>`<div class="bucket-item"><label class="bucket-check"><input type="checkbox" data-action="complete-bucket" data-id="${escape(c.id)}" aria-label="Mark ${escape(c.name)} as played"/><span>${icon('check')}</span></label><button class="bucket-name" data-action="edit-bucket" data-id="${escape(c.id)}"><strong>${escape(c.name)}</strong>${c.location?`<small>${escape(c.location)}</small>`:''}</button><button class="icon-button" data-action="delete-bucket" data-id="${escape(c.id)}" aria-label="Remove ${escape(c.name)} from bucket list">${icon('close')}</button></div>`).join('');
}
async function persist(next, message) {
  if (busy) return false;
  if(mode!=='cloud'&&mode!=='local'){toast('Your passport connection is unavailable. Reload this page before making changes.');return false;}
  busy = true; document.body.classList.add('saving');
  try {
    if (mode==='cloud') {
      const result = await cloudSave(next,revision); profile = result.profile; revision = result.revision;
    } else { profile = await saveProfile(next); profiles = profiles.filter(p=>p.id!==profile.id).concat(profile); localStorage.setItem(ACTIVE_PROFILE_KEY,profile.id); }
    render(); if(message) toast(message); return true;
  } catch(error) {
    if(error.code==='SYNC_CONFLICT'){
      const formError=$('.form-error', $('#modal-root'));
      if(formError)formError.innerHTML='This passport changed on another device. Your current form details are still here. <button type="button" class="conflict-reload" data-action="reload-conflict">Load latest saved passport</button>';
      else toast('Your passport changed on another device. Open Privacy & your data and refresh before trying again.');
    }else toast(error.message || 'Your changes could not be saved. Please try again.');return false;
  }
  finally {busy=false;document.body.classList.remove('saving');}
}
function ensureProfile(action) {
  if(mode==='loading'){toast('Your passport is still opening. Please try again in a moment.');return;}
  if(mode==='error'){toast('The connection is unavailable. Reload this page to try again before making changes.');return;}
  if (profile) {action();return;}
  pendingAction = action;
  if (mode==='cloud' && user) {showModal('profile');} else showModal('account');
}
function showModal(type, data) {
  lastFocus = document.activeElement; modal = type;
  if(type==='course') {
    const c=data || {id:uid(),name:'',location:'',score:'',favoriteHoles:'',rating:0,comments:'',photos:[],playedAt:today(),createdAt:new Date().toISOString()};
    const index=current().courses.findIndex(x=>x.id===c.id);
    draft={...structuredClone(c), rank:index<0?current().courses.length:index, editing:index>=0};
  }
  if(type==='bucket') draft = data ? {...data} : {id:uid(),name:'',location:'',createdAt:new Date().toISOString()};
  renderModal();
}
function closeModal() {$('#modal-root').innerHTML='';modal=null;draft=null;document.body.classList.remove('modal-open');$('#app').inert=false;(lastFocus?.isConnected ? lastFocus : $('.profile-button'))?.focus();}
function modalShell(title,subtitle,body,actions='',wide=false) {
  return `<div class="modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><span class="section-kicker">THE GOLF PASSPORT</span><h2 id="modal-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></header>${body}${actions}</section></div>`;
}
function renderModal() {
  let html='';
  if(modal==='account') {
    html=modalShell('Your next chapter starts here.','One account. All your rounds, wherever you play.',`<div class="account-art"><img src="./assets/empty-bucket.svg" alt=""/></div><div class="account-copy"><p>Sign in to keep your courses, photos, bucket list, and rankings in sync across devices.</p>${mode==='local'?`<div class="notice">Cross-device accounts require the hosted service. This local preview saves only on this browser.</div><button class="button dark full" data-action="local-profile">Try on this browser</button>${profiles.length?`<div class="profile-options">${profiles.map(p=>`<button data-action="choose-profile" data-id="${escape(p.id)}"><span class="avatar">${escape(initials(p.name))}</span><span>${escape(p.name)}<small>${p.courses.length} courses · this browser</small></span></button>`).join('')}</div>`:''}`:`<a class="button dark full" href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a>`}<p class="privacy-note">Your passport is private to your account. Your photos and course notes are never added to the public website code.</p></div>`);
  }
  if(modal==='profile') html=modalShell('Make it your passport.','What should we call you?',`<form id="profile-form" class="simple-form"><label>Your name<input name="name" required maxlength="80" autocomplete="given-name" placeholder="e.g. Sophia" value="${escape(user?.name || '')}"/></label><p class="muted">${mode==='cloud'?'Your passport will sync with your signed-in account.':'This preview is saved only on this browser. It has no account password or cross-device sync.'}</p><div class="form-error" role="alert"></div><button class="button dark full" type="submit">Start my passport</button></form>`);
  if(modal==='bucket') html=modalShell(current().bucket.some(x=>x.id===draft.id)?'A little change of plans.':'Dream up your next tee time.','Every great round starts with a course on the list.',`<form id="bucket-form" class="simple-form"><label>Course name <span>*</span><input name="name" required maxlength="160" placeholder="Which course is calling?" value="${escape(draft.name)}"/></label><label>Location <small>optional</small><input name="location" maxlength="160" placeholder="City, state, or country" value="${escape(draft.location)}"/></label><div class="form-error" role="alert"></div><div class="modal-actions"><button type="button" class="button outline" data-action="close-modal">Cancel</button><button class="button dark" type="submit">${icon('plus')} Save to bucket list</button></div></form>`);
  if(modal==='course') html=modalShell(draft.editing?'A round worth remembering.':'Put another course in the books.','The score is only part of the story.',`<form id="course-form"><div class="course-form-layout"><div class="course-fields"><label>Course name <span>*</span><input name="name" required maxlength="160" placeholder="Where did you play?" value="${escape(draft.name)}"/></label><label>Location <small>optional</small><input name="location" maxlength="160" placeholder="City, state, or country" value="${escape(draft.location)}"/></label><div class="field-row"><label>What did you shoot?<input name="score" maxlength="40" placeholder="e.g. 84" value="${escape(draft.score)}"/></label><label>Date played<input name="playedAt" type="date" value="${escape(draft.playedAt)}"/></label></div><label>Favorite hole(s)<input name="favoriteHoles" maxlength="400" placeholder="e.g. 7, 12, and that view on 18" value="${escape(draft.favoriteHoles)}"/></label><div class="rating-field"><label for="rating">Your course rating <span id="rating-number">${draft.rating.toFixed(1)} / 5</span></label><div class="rating-preview">${stars(draft.rating)}</div><input type="range" min="0" max="5" step="0.5" id="rating" name="rating" value="${draft.rating}" aria-valuetext="${draft.rating} out of 5 stars"/><div class="range-labels"><span>0 · Not my course</span><span>5 · A new favorite</span></div><small>Half-star steps. Every rating from 0 to 5.</small></div><label>The things you’ll remember<textarea name="comments" rows="3" maxlength="10000" placeholder="The back-nine comeback. The perfect sunset. The one that got away…">${escape(draft.comments)}</textarea></label><label class="photo-upload">${icon('camera')}<strong>Add photos from your round</strong><small>JPEG, PNG, or WebP · up to 12 photos</small><input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" multiple/></label><div class="upload-status" role="status"></div><div id="photo-previews">${photoPreviews()}</div></div><aside class="ranking-panel"><div class="ranking-title">${icon('star')}<h3>Where does it rank?</h3></div><p>Place this course among your favorites. Drag it into position, or use the chevrons.</p><div class="ranking-labels"><span>MOST LOVED</span><span>YOUR RANKING</span></div><div id="draft-ranking">${draftRankingHTML()}</div><p class="ranking-footnote">Your list, your rules. You can change the order any time.</p></aside></div><div class="form-error" role="alert"></div><div class="modal-actions"><span class="save-note">${icon(mode==='cloud'?'cloud':'book')}${mode==='cloud'?'Private & synced to your account':'Saved on this browser'}</span><button type="button" class="button outline" data-action="close-modal">Cancel</button><button class="button dark" type="submit">${icon('check')} Save round</button></div></form>`, '', true);
  if(modal==='view') html=viewHTML(draft);
  if(modal==='album') html=albumHTML();
  if(modal==='settings') html=settingsHTML();
  $('#modal-root').innerHTML=html; document.body.classList.add('modal-open');$('#app').inert=true;
  requestAnimationFrame(()=>{const el=$('input:not([type=file]):not([type=hidden])', $('#modal-root')) || $('button,a[href]', $('#modal-root'));el?.focus();});
}
function photoPreviews(){return draft.photos.map(p=>`<div class="photo-preview"><img src="${p.dataUrl}" alt="${escape(p.name)}"/><button type="button" data-action="remove-photo" data-id="${escape(p.id)}" aria-label="Remove ${escape(p.name)}">${icon('close')}</button></div>`).join('');}
function draftRankingHTML(){
  const list=current().courses.filter(c=>c.id!==draft.id); list.splice(draft.rank,0,{id:draft.id,name:draft.name || 'Your new course',candidate:true});
  return list.map((c,i)=>`<div class="ranking-row ${c.candidate?'candidate':''}" data-rank-id="${escape(c.id)}" ${c.candidate?'draggable="true"':''}><span class="ranking-number">${i+1}</span><span class="ranking-name">${escape(c.name)}</span>${c.candidate?`<span class="rank-controls"><button type="button" data-action="draft-up" aria-label="Rank this course higher" ${i===0?'disabled':''}>${icon('up')}</button>${icon('grip')}<button type="button" data-action="draft-down" aria-label="Rank this course lower" ${i===list.length-1?'disabled':''}>${icon('down')}</button></span>`:''}</div>`).join('');
}
function viewHTML(c) {return modalShell(escape(c.name),`${escape(c.location || 'A little piece of your golf story')} · ${formatDate(c.playedAt)}`,`<div class="detail-content"><div class="detail-rating">${stars(c.rating)}<strong>${c.rating.toFixed(1)} / 5</strong><span class="rank-pill">#${current().courses.findIndex(x=>x.id===c.id)+1} on your list</span></div><div class="detail-stats"><div><small>WHAT YOU SHOT</small><strong>${escape(c.score || 'Not added yet')}</strong></div><div><small>FAVORITE HOLE(S)</small><strong>${escape(c.favoriteHoles || 'Not added yet')}</strong></div></div>${c.comments?`<div class="memory-note"><span>ROUND NOTES</span><p>${escape(c.comments)}</p></div>`:''}<div class="detail-gallery">${c.photos.length?c.photos.map(p=>`<figure><img src="${p.dataUrl}" alt="${escape(p.name)}"/></figure>`).join(''):`<div class="no-photos">${icon('camera')} No photos yet. Add a few from your round.</div>`}</div><div class="modal-actions"><button class="button danger-link" data-action="delete-course" data-id="${escape(c.id)}">${icon('trash')} Delete course</button><button class="button dark" data-action="edit-course" data-id="${escape(c.id)}">${icon('edit')} Edit round</button></div></div>`, '', true);}
function albumHTML(){const all=current().courses.flatMap(c=>c.photos.map(p=>({...p,course:c})));return modalShell('A few thousand words.','Your rounds, through your lens.',`<div class="album-grid">${all.length?all.map(p=>`<button data-action="view" data-id="${escape(p.course.id)}"><img src="${p.dataUrl}" alt="${escape(p.name)}"/><span>${escape(p.course.name)}</span></button>`).join(''):`<div class="empty-state"><img src="./assets/empty-played.svg" alt=""/><h3>The best souvenirs are memories.</h3><p>Add photos when you log a round.<br>You’ll find them all here.</p><button class="button dark" data-action="add-course">${icon('camera')} Log a round</button></div>`}</div>`, '', true);}
function settingsHTML(){return modalShell('Your passport. Your data.','A little housekeeping for your clubhouse.',`<div class="settings-content"><div class="notice">${mode==='cloud'?'You are signed in with ChatGPT. Your courses, rankings, and photos are stored privately with your account and available on your other devices.':'This is a browser-only preview. It does not sync across devices. Clearing browser data removes this preview’s saved records.'}</div>${profile?`<div class="settings-row"><div><strong>${escape(profile.name)}</strong><p>${profile.courses.length} played · ${profile.bucket.length} bucket list courses</p></div><span class="avatar">${escape(initials(profile.name))}</span></div><button class="setting-button" data-action="export">${icon('download')}<span>Export a passport backup<small>Download your courses, photos, and rankings as JSON.</small></span></button><label class="setting-button">${icon('book')}<span>Import a passport backup<small>Merge courses and photos into this passport. Existing records with matching IDs are replaced.</small></span><input class="sr-only" type="file" id="import-input" accept="application/json,.json"/></label>${mode==='cloud'?`<button class="setting-button" data-action="refresh">${icon('cloud')}<span>Refresh from your account<small>Load the latest saved version from another device.</small></span></button>`:''}<button class="setting-button" data-action="sign-out">${icon('logout')}<span>Sign out<small>Your saved passport will be here when you return.</small></span></button><button class="setting-button danger" data-action="reset">${icon('trash')}<span>Delete this passport<small>Permanently remove your courses, rankings, and photos.</small></span></button>`:`<button class="button dark full" data-action="account">Sign in to start a passport</button>`}<p class="privacy-note">We never publish your journal in the GitHub repository. No advertising trackers are used. Backups contain your photos and notes; keep them somewhere private.</p></div>`);}

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]'); if(!button || button.disabled || busy)return;
  const action=button.dataset.action, id=button.dataset.id;
  if(action==='close-modal'){closeModal();return;}
  if(action==='home'){closeModal();$('#main').scrollIntoView({behavior:'smooth'});return;}
  if(action==='account'){if(mode==='loading'||mode==='error'){ensureProfile(()=>{});return;}showModal(profile?'settings':user?'profile':'account');return;}
  if(action==='local-profile'){showModal('profile');return;}
  if(action==='choose-profile'){profile=profiles.find(p=>p.id===id);localStorage.setItem(ACTIVE_PROFILE_KEY,id);closeModal();render();pendingAction?.();pendingAction=null;return;}
  if(action==='add-course'){ensureProfile(()=>showModal('course'));return;}
  if(action==='add-bucket'){ensureProfile(()=>showModal('bucket'));return;}
  if(action==='edit-course'){const c=current().courses.find(c=>c.id===id);if(c)showModal('course',c);return;}
  if(action==='edit-bucket'){showModal('bucket',current().bucket.find(c=>c.id===id));return;}
  if(action==='album'){showModal('album');return;}
  if(action==='settings'){showModal('settings');return;}
  if(action==='view'){draft=current().courses.find(c=>c.id===id);showModal('view');return;}
  if(action==='clear-search'){search='';render();$('#course-search').focus();return;}
  if(action==='remove-photo'){draft.photos=draft.photos.filter(p=>p.id!==id);$('#photo-previews').innerHTML=photoPreviews();return;}
  if(action==='draft-up'||action==='draft-down'){draft.rank=Math.max(0,Math.min(current().courses.filter(c=>c.id!==draft.id).length,draft.rank+(action==='draft-up'?-1:1)));$('#draft-ranking').innerHTML=draftRankingHTML();return;}
  if(action==='rank-up'||action==='rank-down'){const index=current().courses.findIndex(c=>c.id===id);await persist({...profile,courses:moveCourse(profile.courses,id,index+(action==='rank-up'?-1:1))},'Your favorites, in your order.');return;}
  if(action==='delete-bucket'){if(confirm('Remove this course from your bucket list?')) await persist({...profile,bucket:profile.bucket.filter(c=>c.id!==id)},'Course removed from your bucket list.');return;}
  if(action==='complete-bucket'){
    event.preventDefault(); const bucket=profile.bucket.find(c=>c.id===id);
    if(!bucket)return;
    const course=normalizeCourse({...bucket,id:uid(),playedAt:today(),photos:[]});
    if(await persist({...profile,courses:[...profile.courses,course],bucket:profile.bucket.filter(c=>c.id!==id)},'Bucket-list dream, officially played.')) showModal('course',course);
    return;
  }
  if(action==='delete-course'){
    if(confirm('Delete this course and its photos? This cannot be undone.')) if(await persist({...profile,courses:profile.courses.filter(c=>c.id!==id)},'Course and photos deleted.')) closeModal();return;
  }
  if(action==='export'){
    const blob=new Blob([JSON.stringify({version:1,profile},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`golf-passport-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your passport backup is ready.');return;
  }
  if(action==='refresh'){
    try {const result=await cloudLoad();if(!result?.user)throw new Error('Please sign in again.');profile=result.profile;revision=result.revision;closeModal();render();toast('Up to date with your account.');}catch(e){toast(e.message);}return;
  }
  if(action==='reload-conflict'){
    const openForm=$('#course-form, #bucket-form, #profile-form');
    const values=openForm ? Object.fromEntries(new FormData(openForm)) : {};
    const retainedDraft=draft?{...draft,...values}:null;
    try{
      const result=await cloudLoad();if(!result?.user)throw new Error('Please sign in again. Your form details remain here.');
      profile=result.profile;revision=result.revision;user=result.user;
      if(!profile && retainedDraft){
        const formError=$('.form-error', $('#modal-root'));
        if(formError)formError.textContent='This passport was deleted on another device. Your unsaved details remain in this form, but cannot be saved into a deleted passport. Copy any notes you want to keep, close this form, then start a new passport.';
        const saveButton=$('button[type=submit]', $('#modal-root'));if(saveButton)saveButton.disabled=true;
        render();$('#app').inert=true;toast('The passport was deleted on another device. Your unsaved form is still open.');return;
      }
      if(modal==='profile'&&profile){closeModal();render();toast('Your account already has a passport. The latest version is now open.');return;}
      if(retainedDraft){draft=retainedDraft;if(modal==='course'){draft.rating=Number(draft.rating);draft.rank=Math.min(draft.rank,current().courses.filter(c=>c.id!==draft.id).length);}}
      render();renderModal();toast('Latest passport loaded. Review your details and save again.');
    }catch(e){toast(e.message);}return;
  }
  if(action==='sign-out'){
    if(mode==='cloud'){location.assign('/signout-with-chatgpt?return_to=%2F');return;}
    localStorage.removeItem(ACTIVE_PROFILE_KEY);profile=null;closeModal();render();toast('Signed out of the local preview.');return;
  }
  if(action==='reset'){
    if(!confirm('Permanently delete this entire passport, including every course and photo? This cannot be undone. Export a backup first if you want to keep it.'))return;
    try {if(mode==='cloud'){const r=await cloudDelete(revision);revision=r.revision ?? null;}else {await deleteProfile(profile.id);profiles=profiles.filter(p=>p.id!==profile.id);localStorage.removeItem(ACTIVE_PROFILE_KEY);}profile=null;closeModal();render();toast('Your passport has been deleted.');}catch(e){toast(e.message);}return;
  }
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='course-search'){const start=el.selectionStart,end=el.selectionEnd;search=el.value;render();const input=$('#course-search');input.focus();input.setSelectionRange(start,end);return;}
  if(el.closest('#course-form') && el.name && el.type!=='file'){
    draft[el.name]=el.name==='rating'?Number(el.value):el.value;
    if(el.name==='name'){$('.candidate .ranking-name').textContent=el.value || 'Your new course';}
    if(el.name==='rating'){$('#rating-number').textContent=`${Number(el.value).toFixed(1)} / 5`;$('.rating-preview').innerHTML=stars(Number(el.value));el.setAttribute('aria-valuetext',`${el.value} out of 5 stars`);}
  }
});
document.addEventListener('change',async event=>{
  if(event.target.id==='sort'){sort=event.target.value;render();return;}
  if(event.target.id==='photo-input'){
    const uploadingDraft=draft;
    const files=[...event.target.files]; const status=$('.upload-status');
    if(files.length+draft.photos.length>12){toast('You can add up to 12 photos per course.');event.target.value='';return;}
    const save=$('#course-form button[type=submit]');save.disabled=true;status.textContent='Getting your photos ready…';
    try {for(const file of files){const photo=await preparePhoto(file);if(draft!==uploadingDraft)return;uploadingDraft.photos.push(photo);}status.textContent=`${files.length} photo${files.length===1?'':'s'} added.`;}
    catch(e){status.textContent=e.message;}
    finally {if(draft===uploadingDraft&&$('#photo-previews'))$('#photo-previews').innerHTML=photoPreviews();save.disabled=false;event.target.value='';}return;
  }
  if(event.target.id==='import-input'){
    try {const file=event.target.files[0];if(!file)return;if(file.size>40*1024*1024)throw new Error('Choose a backup smaller than 40 MB.');const incoming=validateBackup(JSON.parse(await file.text()));if(!confirm(`Merge ${incoming.courses.length} courses and ${incoming.bucket.length} bucket-list courses into your passport? Records with matching IDs will be replaced.`))return;
      const courses=new Map(profile.courses.map(c=>[c.id,c]));incoming.courses.forEach(c=>courses.set(c.id,c));const bucket=new Map(profile.bucket.map(c=>[c.id,c]));incoming.bucket.forEach(c=>bucket.set(c.id,c));if(await persist({...profile,courses:[...courses.values()],bucket:[...bucket.values()]},'Your passport backup has been imported.'))closeModal();
    }catch(e){toast(e.message || 'That file could not be imported.');}return;
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!['profile-form','course-form','bucket-form'].includes(form.id))return;event.preventDefault();
  const error=$('.form-error',form);error.textContent='';const submit=$('button[type=submit]',form);submit.disabled=true;
  try {
    const values=Object.fromEntries(new FormData(form));
    if(form.id==='profile-form'){
      const name=values.name.trim();if(!name)throw new Error('Please add your name.');
      const next={id:mode==='cloud'?user.id:uid(),name,createdAt:new Date().toISOString(),courses:[],bucket:[]};
      if(await persist(next,'Your passport is ready. Let’s make some memories.')){closeModal();const action=pendingAction;pendingAction=null;action?.();}
    }
    if(form.id==='bucket-form'){
      const c=normalizeBucket({...draft,...values});
      if(await persist({...profile,bucket:profile.bucket.some(x=>x.id===c.id)?profile.bucket.map(x=>x.id===c.id?c:x):[...profile.bucket,c]},'One more reason to plan a tee time.'))closeModal();
    }
    if(form.id==='course-form'){
      const course=normalizeCourse({...draft,...values,rating:Number(values.rating)});
      const courses=profile.courses.filter(c=>c.id!==course.id);courses.splice(draft.rank,0,course);
      if(await persist({...profile,courses},draft.editing?'Your round is updated.':'Another great course in the books.'))closeModal();
    }
  }catch(e){error.textContent=e.message;}
  finally {if(submit.isConnected)submit.disabled=false;}
});
async function preparePhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Please choose a JPEG, PNG, or WebP photo.');
  if(file.size>15*1024*1024)throw new Error('Each original photo must be smaller than 15 MB.');
  const url=URL.createObjectURL(file);
  try {const image=new Image();image.src=url;await image.decode();const scale=Math.min(1,1600/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return {id:uid(),name:file.name.slice(0,200),dataUrl:canvas.toDataURL('image/jpeg',0.82)};}
  finally{URL.revokeObjectURL(url);}
}
document.addEventListener('dragstart',event=>{
  const row=event.target.closest('.candidate[data-rank-id]');
  const card=event.target.closest('.course-card[draggable]');
  if(!row&&!card)return;
  drag={type:row?'draft':'course',id:row?draft.id:card.dataset.course};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',drag.id);(row||card).classList.add('dragging');
});
document.addEventListener('dragover',event=>{
  if(!drag)return;const target=event.target.closest(drag.type==='draft'?'.ranking-row':'.course-card');if(target){event.preventDefault();event.dataTransfer.dropEffect='move';document.querySelectorAll('.drag-over').forEach(e=>e.classList.remove('drag-over'));target.classList.add('drag-over');}
});
document.addEventListener('drop',async event=>{
  if(!drag)return;event.preventDefault();const target=event.target.closest(drag.type==='draft'?'.ranking-row':'.course-card');if(!target)return;
  if(drag.type==='draft'){draft.rank=[...target.parentNode.children].indexOf(target);$('#draft-ranking').innerHTML=draftRankingHTML();}
  else {const index=profile.courses.findIndex(c=>c.id===target.dataset.course);if(index>=0)await persist({...profile,courses:moveCourse(profile.courses,drag.id,index)},'Your ranking is updated.');}
  drag=null;document.querySelectorAll('.drag-over,.dragging').forEach(e=>e.classList.remove('drag-over','dragging'));
});
document.addEventListener('dragend',()=>{drag=null;document.querySelectorAll('.drag-over,.dragging').forEach(e=>e.classList.remove('drag-over','dragging'));});
document.addEventListener('keydown',event=>{
  if(!modal)return;
  if(event.key==='Escape'&&!busy){closeModal();return;}
  if(event.key==='Tab'){const focusable=[...$('#modal-root').querySelectorAll('button:not([disabled]),[href],input:not([type=hidden]):not([disabled]),textarea,select')].filter(el=>el.getClientRects().length);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden||mode!=='cloud'||modal||busy)return;
  const previousRevision=revision;
  try{const result=await cloudLoad();if(!modal&&!busy&&revision===previousRevision&&result?.user&&result.revision!==revision){profile=result.profile;revision=result.revision;render();toast('Your passport is up to date.');}}catch{}
});
async function init(){
  render();
  try{
    const session=await getSession();
    if(session?.local){mode='local';profiles=await loadProfiles();const active=localStorage.getItem(ACTIVE_PROFILE_KEY);profile=profiles.find(p=>p.id===active)||null;}
    else{mode='cloud';user=session?.user||null;profile=session?.profile||null;revision=session?.revision||null;}
  }catch(e){mode='error';toast(e.message || 'We couldn’t open your passport. Please reload and try again.');}
  render();
}
init();
