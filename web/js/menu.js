// One shared popover menu for "More" buttons.
import { h, icon } from './dom.js';

const menu = document.getElementById('menu');
const supportsPopover = typeof menu.showPopover === 'function';
if (!supportsPopover) menu.hidden = true;
let invoker = null;
let lastClosed = { button: null, time: 0 };

// items: { label, icon?, run?, href?, download?, disabled?, hint? } or 'separator'
export function openMenu(button, items, { label = 'Options' } = {}) {
  if (invoker === button && isOpen()) {
    closeMenu();
    return;
  }
  // A click on the button that light-dismissed this menu should not reopen it.
  if (lastClosed.button === button && performance.now() - lastClosed.time < 400) return;
  closeMenu(false);
  menu.setAttribute('aria-label', label);
  menu.replaceChildren(...items.filter(Boolean).map(item => (item === 'separator' ? h('div', { class: 'menu-sep', role: 'separator' }) : menuItem(item))));
  invoker = button;
  button.setAttribute('aria-expanded', 'true');
  if (supportsPopover) menu.showPopover();
  else menu.hidden = false;
  position(button);
  menu.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
}

function menuItem(item) {
  const content = [item.icon ? icon(item.icon) : h('span', { class: 'icon' }), h('span', { class: 'menu-label' }, item.label), item.hint ? h('span', { class: 'menu-hint' }, item.hint) : null];
  if (item.href && !item.disabled) {
    return h('a', {
      role: 'menuitem',
      class: 'menu-item',
      href: item.href,
      download: item.download ?? null,
      tabindex: '-1',
      onclick: () => {
        closeMenu();
        item.run?.();
      },
    }, content);
  }
  return h('button', {
    type: 'button',
    role: 'menuitem',
    class: 'menu-item',
    tabindex: '-1',
    'aria-disabled': item.disabled ? 'true' : null,
    onclick: () => {
      if (item.disabled) return;
      closeMenu();
      item.run?.();
    },
  }, content);
}

function isOpen() {
  return supportsPopover ? menu.matches(':popover-open') : !menu.hidden;
}

export function closeMenu(restoreFocus = true) {
  if (!invoker) return;
  const button = invoker;
  invoker = null;
  button.setAttribute('aria-expanded', 'false');
  if (isOpen()) {
    if (supportsPopover) menu.hidePopover();
    else menu.hidden = true;
  }
  if (restoreFocus && button.isConnected) button.focus();
}

function position(button) {
  const rect = button.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const gap = 6;
  let left = rect.right - width;
  if (left < 8) left = Math.min(rect.left, window.innerWidth - width - 8);
  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - gap);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
}

menu.addEventListener('keydown', event => {
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const index = items.indexOf(document.activeElement);
  const focus = i => items[(i + items.length) % items.length]?.focus();
  if (event.key === 'ArrowDown') focus(index + 1);
  else if (event.key === 'ArrowUp') focus(index - 1);
  else if (event.key === 'Home') focus(0);
  else if (event.key === 'End') focus(items.length - 1);
  else if (event.key === 'Escape') closeMenu();
  else if (event.key === 'Tab') closeMenu(false);
  else return;
  event.preventDefault();
  event.stopPropagation();
});

if (supportsPopover) {
  // Light dismiss (outside click) closes the popover without our help.
  menu.addEventListener('toggle', event => {
    if (event.newState === 'closed' && invoker) {
      invoker.setAttribute('aria-expanded', 'false');
      lastClosed = { button: invoker, time: performance.now() };
      invoker = null;
    }
  });
} else {
  document.addEventListener('pointerdown', event => {
    if (invoker && !menu.contains(event.target) && !invoker.contains(event.target)) closeMenu(false);
  });
}

window.addEventListener('resize', () => closeMenu(false));
