import {
  FileArchive,
  FileAudio,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  File as GenericFile,
  Presentation,
} from 'lucide-react';
import {
  getFileCategory,
  getFileExtension,
  getOfficePreviewType,
  isPdfFile,
} from '../utils/fileHelpers';

interface FileIconProps {
  type: 'folder' | 'file';
  mimeType: string;
  filename: string;
  size?: 'sm' | 'md' | 'lg';
}

function PdfDocumentIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M6 2.75h7.25L18.25 7.75V19.5a1.75 1.75 0 0 1-1.75 1.75H6a1.75 1.75 0 0 1-1.75-1.75V4.5A1.75 1.75 0 0 1 6 2.75Z"
        className="fill-red-500/12 stroke-red-600 dark:fill-red-400/15 dark:stroke-red-400"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        d="M13.25 2.75V7.75h5"
        className="stroke-red-600 dark:stroke-red-400"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="2.75"
        y="11.25"
        width="13.5"
        height="6.75"
        rx="1.5"
        className="fill-red-600 dark:fill-red-500"
      />
      <text
        x="9.5"
        y="16.1"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="5"
        fontWeight="800"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        letterSpacing="0.3"
      >
        PDF
      </text>
    </svg>
  );
}

export function FileIcon({ type, mimeType, filename, size = 'md' }: FileIconProps) {
  const dim = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-5 w-5';

  if (type === 'folder') {
    return (
      <Folder
        className={`${dim} fill-amber-400/25 text-amber-500 dark:fill-amber-400/20 dark:text-amber-400`}
      />
    );
  }

  if (isPdfFile(mimeType, filename)) {
    return <PdfDocumentIcon className={dim} />;
  }

  const officeType = getOfficePreviewType(mimeType, filename);
  const ext = getFileExtension(filename);

  if (officeType === 'excel' || ext === 'csv') {
    return <FileSpreadsheet className={`${dim} text-emerald-600 dark:text-emerald-400`} />;
  }

  if (officeType === 'pptx' || ext === 'ppt') {
    return <Presentation className={`${dim} text-orange-600 dark:text-orange-400`} />;
  }

  const category = getFileCategory(mimeType, filename);

  switch (category) {
    case 'image':
      return <FileImage className={`${dim} text-pink-600 dark:text-pink-400`} />;
    case 'video':
      return <FileVideo className={`${dim} text-purple-600 dark:text-purple-400`} />;
    case 'audio':
      return <FileAudio className={`${dim} text-amber-600 dark:text-amber-400`} />;
    case 'archive':
      return <FileArchive className={`${dim} text-orange-600 dark:text-orange-400`} />;
    case 'code':
      return <FileCode2 className={`${dim} text-cyan-600 dark:text-cyan-400`} />;
    case 'document':
      return <FileText className={`${dim} text-blue-600 dark:text-blue-400`} />;
    default:
      return <GenericFile className={`${dim} text-slate-500 dark:text-slate-400`} />;
  }
}
