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
} from 'lucide-react';
import { getFileCategory, getFileExtension } from '../utils/fileHelpers';

interface FileIconProps {
  type: 'folder' | 'file';
  mimeType: string;
  filename: string;
  size?: 'sm' | 'md' | 'lg';
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

  const category = getFileCategory(mimeType, filename);
  const ext = getFileExtension(filename);

  if (ext === 'csv' || ext === 'xls' || ext === 'xlsx') {
    return <FileSpreadsheet className={`${dim} text-emerald-600 dark:text-emerald-400`} />;
  }

  switch (category) {
    case 'image':
      return <FileImage className={`${dim} text-rose-600 dark:text-rose-400`} />;
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
