import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';

export interface MaskImages {
  source: Blob;
  mask?: Blob;
  width: number;
  height: number;
}

export default function WorkspaceMaskEditor({
  images,
  onSave,
  onClose,
  allowEmpty,
}: {
  images: MaskImages;
  allowEmpty: boolean;
  onSave: (file: File) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<ImageData[]>([]);
  const stroke = useRef<{ id: number; x: number; y: number }>();
  const [url, setURL] = useState('');
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [eraser, setEraser] = useState(false);
  const [diameter, setDiameter] = useState(48);
  const [undoCount, setUndoCount] = useState(0);
  const [message, setMessage] = useState('');
  const { width, height } = images;

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    const src = URL.createObjectURL(images.source);
    setURL(src);
    let live = true;
    async function load() {
      if (images.mask) {
        const bitmap = await createImageBitmap(images.mask);
        try {
          if (!live) return;
          const ctx = canvas.current!.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          const pixels = ctx.getImageData(0, 0, width, height);
          for (let i = 0; i < pixels.data.length; i += 4)
            pixels.data[i + 3] = pixels.data[i];
          ctx.putImageData(pixels, 0, 0);
        } finally {
          bitmap.close();
        }
      }
      if (live) setReady(true);
    }
    load().catch(() => {
      if (live) setMessage('저장된 마스크를 읽을 수 없습니다.');
    });
    return () => {
      live = false;
      URL.revokeObjectURL(src);
      modal?.close();
    };
  }, [images, width, height]);

  function remember(ctx: CanvasRenderingContext2D) {
    const limit = Math.max(
      1,
      Math.min(12, Math.floor((24 * 1024 * 1024) / (width * height * 4))),
    );
    if (history.current.length >= limit) history.current.shift();
    history.current.push(ctx.getImageData(0, 0, width, height));
    setUndoCount(history.current.length);
  }
  function point(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * width) / rect.width,
      y: ((e.clientY - rect.top) * height) / rect.height,
    };
  }
  function paint(e: PointerEvent<HTMLCanvasElement>, start: boolean) {
    if (
      !ready ||
      saving ||
      (start
        ? e.button !== 0 || !!stroke.current
        : stroke.current?.id !== e.pointerId)
    )
      return;
    const ctx = e.currentTarget.getContext('2d')!;
    const pos = point(e);
    if (start) {
      remember(ctx);
      setMessage('');
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    ctx.save();
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = diameter;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (stroke.current) {
      ctx.moveTo(stroke.current.x, stroke.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else {
      ctx.arc(pos.x, pos.y, diameter / 2, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
    stroke.current = { id: e.pointerId, ...pos };
  }
  function undo() {
    const last = history.current.pop();
    if (last) canvas.current!.getContext('2d')!.putImageData(last, 0, 0);
    setUndoCount(history.current.length);
  }
  async function save() {
    const surface = canvas.current!;
    const pixels = surface
      .getContext('2d')!
      .getImageData(0, 0, width, height).data;
    let selected = false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] >= 128) {
        selected = true;
        break;
      }
    }
    if (!allowEmpty && !selected) {
      setMessage('다시 그릴 영역을 칠하세요.');
      return;
    }
    setSaving(true);
    try {
      const binary = document.createElement('canvas');
      binary.width = width;
      binary.height = height;
      const ctx = binary.getContext('2d')!;
      const image = ctx.createImageData(width, height);
      for (let i = 0; i < pixels.length; i += 4) {
        const value = pixels[i + 3] >= 128 ? 255 : 0;
        image.data[i] = value;
        image.data[i + 1] = value;
        image.data[i + 2] = value;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        binary.toBlob((b) => {
          if (b) resolve(b);
          else reject(Error());
        }, 'image/png');
      });
      if (await onSave(new File([blob], 'mask.png', { type: 'image/png' })))
        onClose();
      else
        setMessage('마스크를 적용하지 못했습니다. 프로젝트 상태를 확인하세요.');
    } catch {
      setMessage('마스크 PNG를 만들지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The modal handles the undo shortcut while a brush tool has focus.
    <dialog
      className="workspace-mask-editor nai-auth"
      ref={dialog}
      onKeyDown={(e) => {
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key.toLowerCase() === 'z' &&
          !saving
        ) {
          e.preventDefault();
          undo();
        }
      }}
      aria-label="인페인팅 마스크 편집"
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
    >
      <header>
        <h2>인페인팅 마스크</h2>
        <button type="button" disabled={saving} onClick={onClose}>
          닫기
        </button>
      </header>
      <p>다시 그릴 영역을 칠하세요. 원본과 같은 위치에 마스크가 적용됩니다.</p>
      <fieldset disabled={!ready || saving}>
        <div className="mask-tools">
          <button
            type="button"
            aria-pressed={!eraser}
            onClick={() => setEraser(false)}
          >
            브러시
          </button>
          <button
            type="button"
            aria-pressed={eraser}
            onClick={() => setEraser(true)}
          >
            지우개
          </button>
          <label htmlFor="mask-size">굵기 {diameter}px</label>
          <input
            id="mask-size"
            type="range"
            min="1"
            max="256"
            value={diameter}
            onChange={(e) => setDiameter(Number(e.target.value))}
          />
          <button type="button" disabled={!undoCount} onClick={undo}>
            되돌리기
          </button>
          <button
            type="button"
            onClick={() => {
              const ctx = canvas.current!.getContext('2d')!;
              remember(ctx);
              ctx.clearRect(0, 0, width, height);
            }}
          >
            초기화
          </button>
        </div>
        <div className="mask-stage">
          {url && <img src={url} alt="마스크를 그릴 원본" />}
          <canvas
            ref={canvas}
            width={width}
            height={height}
            aria-label="다시 그릴 영역"
            onPointerDown={(e) => paint(e, true)}
            onPointerMove={(e) => paint(e, false)}
            onLostPointerCapture={(e) => {
              if (stroke.current?.id === e.pointerId)
                stroke.current = undefined;
            }}
          />
        </div>
        <button type="button" onClick={save}>
          마스크 적용
        </button>
      </fieldset>
      <p role="status">{message}</p>
    </dialog>
  );
}
