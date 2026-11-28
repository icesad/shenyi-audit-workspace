(function (root) {
  'use strict';

  const inputs = new WeakMap();

  function present(zone, input, {material, limit, title, before} = {}) {
    zone.classList.add('upload-drop');
    const formats = input.accept.split(',').map(value => value.trim()).filter(value => value.startsWith('.'));
    const hint = ['可拖入或点击选择' + (input.multiple ? '多份文件' : '文件'),
      formats.map(value => value.slice(1).toUpperCase()).join('、'), limit].filter(Boolean).join(' · ');
    zone.title = hint;
    const caption = zone.textContent.trim();
    const control = zone.tagName === 'BUTTON' ? zone : input;
    control.setAttribute('aria-description', hint);
    if (title || !control.hasAttribute('aria-label')) {
      const action = caption && !['上传', '选择文件'].includes(caption) ? caption : material;
      control.setAttribute('aria-label', title || action || input.id);
    }
    // File names and status elements stay beside the target as selections change.
    for (const node of Array.from(zone.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    }
    const face = zone.ownerDocument.createElement('span');
    face.className = 'upload-drop-face';
    face.textContent = material || caption || control.getAttribute('aria-label');
    face.setAttribute('aria-hidden', 'true');
    zone.insertBefore(face, before || zone.querySelector('small') || null);
  }

  function bind(zone, input, options = {}) {
    const {beforeDrop} = options;
    inputs.set(zone, input);
    present(zone, input, options);
    const notice = zone.ownerDocument.createElement('span');
    notice.className = 'upload-drop-notice';
    notice.setAttribute('role', 'status');
    zone.append(notice);
    const blocked = () => input.matches(':disabled') || zone.matches(':disabled,[aria-disabled="true"]') || !!zone.closest('[inert],[hidden]');
    const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
    const reject = message => { notice.textContent = message; };
    zone.addEventListener('dragover', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = blocked() ? 'none' : 'copy';
      zone.classList.toggle('is-dragover', !blocked());
    });
    zone.addEventListener('dragleave', event => {
      if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover');
    });
    zone.addEventListener('drop', event => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      zone.classList.remove('is-dragover');
      if (blocked()) return;
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return;
      if (!input.multiple && files.length > 1) return reject('此处每次只能上传一份文件。');
      const accepted = input.accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      const invalid = files.find(file => accepted.length && !accepted.some(value =>
        value.startsWith('.') ? file.name.toLowerCase().endsWith(value) :
        value.endsWith('/*') ? file.type.startsWith(value.slice(0, -1)) : file.type === value));
      if (invalid) return reject('此处不支持该文件格式：' + invalid.name);
      if (beforeDrop && !beforeDrop()) return;
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
    });
    input.addEventListener('change', () => {
      notice.textContent = '';
      // Some workflows stage the selected files until a separate save action.
      if (options.echoSelection !== false) {
        queueMicrotask(() => { notice.textContent = Array.from(input.files, file => file.name).join('、'); });
      }
    });
    return zone;
  }

  function area(input, title, options) {
    const label = input.ownerDocument.createElement('label');
    label.append(title, input);
    return bind(label, input, options);
  }

  function clearEmptySelections(container) {
    for (const zone of container.querySelectorAll('.upload-drop')) {
      const input = inputs.get(zone);
      if (input && !input.files.length) zone.querySelector('.upload-drop-notice').textContent = '';
    }
  }
  document.addEventListener('reset', event => queueMicrotask(() => clearEmptySelections(event.target)));
  document.addEventListener('toggle', event => {
    if (event.target.matches('dialog[open]')) clearEmptySelections(event.target);
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    for (const [id, material] of [['tender-file', '招标文件或询价函'], ['quote-reference-input', '以往报价参考资料']]) {
      const input = document.getElementById(id);
      if (input) present(input.closest('label'), input, {material, limit:'单份最多 100 MB'});
    }
    for (const [id, material] of [['bd-original-file', '招标原件'], ['import-backup-file', '备份文件']]) {
      const input = document.getElementById(id);
      if (input) bind(input.closest('label'), input, {material});
    }
  });

  root.ShenyiFileDrop = Object.freeze({bind, area, present});
})(globalThis);
