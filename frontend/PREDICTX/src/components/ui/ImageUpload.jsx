// Image picker with preview. The chosen File is sent to the API as multipart
// form data; the server re-checks the real file type and size (client checks
// here are only for quick feedback).
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';

const MAX_BYTES = 2 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * props:
 *   current  — URL of the image already saved (or null)
 *   onChange — ({ file, remove }) whenever the selection changes
 *   onError  — (message) for invalid files
 */
export default function ImageUpload({ current, onChange, onError }) {
  const input = useRef(null);
  const [preview, setPreview] = useState(current || '');

  useEffect(() => setPreview(current || ''), [current]);
  useEffect(() => () => { if (preview.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type)) return onError?.('Please choose a JPEG, PNG or WebP image.');
    if (file.size > MAX_BYTES) return onError?.('Images must be 2 MB or smaller.');
    setPreview(URL.createObjectURL(file));
    onChange({ file, remove: false });
  }

  function clear() {
    setPreview('');
    onChange({ file: null, remove: true });
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-ink-2">
        {preview ? <img src={preview} alt="Preview" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-muted" />}
        {preview && <button type="button" onClick={clear} className="absolute right-1 top-1 rounded-md bg-ink/80 p-0.5" aria-label="Remove image"><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => input.current?.click()}>Upload image</button>
        <p className="mt-1 text-[11px] text-muted">JPEG, PNG or WebP · max 2 MB</p>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} />
      </div>
    </div>
  );
}
