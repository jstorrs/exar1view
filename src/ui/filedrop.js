// @ts-check
/**
 * Window-level file drag and drop. Adds `body.dragging` (the overlay in
 * app.css) while files are dragged over the page and calls `onFiles` on drop.
 */

/**
 * @param {(files: File[]) => void} onFiles
 */
export function installFileDrop(onFiles) {
  // Enter/leave depth, cleared on drop/dragend and by a timeout after the last
  // dragover (covers cancelled drags and browsers without relatedTarget).
  let depth = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const end = () => {
    depth = 0;
    clearTimeout(timer);
    document.body.classList.remove('dragging');
  };
  /** @param {DragEvent} e */
  const hasFiles = (e) => e.dataTransfer?.types.includes('Files') ?? false;

  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) depth++; });
  window.addEventListener('dragleave', (e) => {
    if (hasFiles(e) && --depth <= 0) end();
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    document.body.classList.add('dragging');
    clearTimeout(timer);
    timer = setTimeout(end, 1000);
  });
  window.addEventListener('dragend', end);
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    end();
    onFiles([...(e.dataTransfer?.files ?? [])]);
  });
}
