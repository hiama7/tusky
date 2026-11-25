// Image picker with preview. Stage 1 stores a small data URL in localStorage;
// Stage 2 uploads the file to PHP (multipart) and stores the returned path.
import { useRef } from 'react';
import { ImagePlus, X } from 'lucide-react';

const MAX_BYTES = 400 * 1024;

export default function ImageUpload({ value, onChange, onError }) {
  const input = useRef(null);
  function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return onError?.('Please choose an image file.');
    if (file.size > MAX_BYTES) return onError?.('Demo limit: images must be under 400 KB (browser storage is small).');
    const reader = new FileReader();
    reader.onload = () => onChange(reader.result);
    reader.readAsDataURL(file);
  }
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-white/15 bg-ink-2">
        {value ? <img src={value} alt="Preview" className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-muted" />}
        {value && <button type="button" onClick={() => onChange('')} className="absolute right-1 top-1 rounded-md bg-ink/80 p-0.5" aria-label="Remove image"><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div>
        <button type="button" className="btn-ghost btn-sm" onClick={() => input.current?.click()}>Upload image</button>
        <p className="mt-1 text-[11px] text-muted">PNG, JPG or SVG · max 400 KB</p>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={pick} />
      </div>
    </div>
  );
}
