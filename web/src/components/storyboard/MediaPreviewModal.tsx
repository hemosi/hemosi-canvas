import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { RowNodeRole } from '@/lib/storyboard/types';

interface MediaPreviewModalProps {
  url: string | null;
  role: RowNodeRole;
  onClose: () => void;
}

export const MediaPreviewModal: React.FC<MediaPreviewModalProps> = ({
  url,
  role,
  onClose,
}) => {
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>

      {role === 'frame' ? (
        <img
          src={url}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="max-h-[94vh] max-w-[94vw] object-contain"
        />
      ) : (
        <video
          src={url}
          controls
          autoPlay
          loop
          onClick={(e) => e.stopPropagation()}
          className="max-h-[94vh] max-w-[94vw] object-contain"
        />
      )}
    </div>
  );
};
