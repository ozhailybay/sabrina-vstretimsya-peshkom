/* Russian by default; English for the hackathon judges. Elements carry their English text in data-en. */
const I18N = (() => {
  let lang = 'ru';
  try { lang = localStorage.getItem('lang') || 'ru'; } catch (e) {}
  const listeners = [];
  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-en]').forEach(el => {
      if (el.dataset.ru === undefined) el.dataset.ru = el.innerHTML;
      el.innerHTML = lang === 'en' ? el.dataset.en : el.dataset.ru;
    });
    document.querySelectorAll('[data-en-ph]').forEach(el => {
      if (el.dataset.ruPh === undefined) el.dataset.ruPh = el.placeholder;
      el.placeholder = lang === 'en' ? el.dataset.enPh : el.dataset.ruPh;
    });
    const b = document.querySelector('.lang'); if (b) b.textContent = lang === 'en' ? 'RU' : 'EN';
    listeners.forEach(f => f(lang));
  }
  function toggle() { lang = lang === 'en' ? 'ru' : 'en'; try { localStorage.setItem('lang', lang); } catch (e) {} apply(); }
  document.addEventListener('DOMContentLoaded', () => {
    const b = document.querySelector('.lang'); if (b) b.addEventListener('click', toggle);
    apply();
  });
  return { t: (ru, en) => lang === 'en' ? en : ru, get lang() { return lang; }, on: f => listeners.push(f), apply };
})();
