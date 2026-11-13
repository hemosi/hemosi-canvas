import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";

export interface ViralExportFile {
    name: string;
    data: BlobPart;
}

/** 导出复刻工程 ZIP 包（S5 复用）。 */
export async function exportViralArchiveZip(title: string, files: ViralExportFile[]): Promise<void> {
    const zipBlob = await createZip(files);
    const safeTitle = (title || "爆款复刻工程包").replace(/[\\/:*?"<>|]/g, "_");
    saveAs(zipBlob, `${safeTitle}.zip`);
}
