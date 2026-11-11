export type AssetFileEntry = {
    file: File;
    path: string; // e.g. "角色/hero.png" or "hero.png"
    folder?: string; // e.g. "角色"
};

/**
 * Recursively scans files from DataTransferItemList supporting directories (folders).
 */
export async function getFilesFromDataTransfer(items: DataTransferItemList | DataTransfer): Promise<AssetFileEntry[]> {
    const results: AssetFileEntry[] = [];
    const entries: any[] = [];

    if ("items" in items && items.items) {
        for (let i = 0; i < items.items.length; i++) {
            const item = items.items[i];
            if (typeof item.webkitGetAsEntry === "function") {
                const entry = item.webkitGetAsEntry();
                if (entry) entries.push(entry);
            } else {
                const file = item.getAsFile();
                if (file) results.push({ file, path: file.name });
            }
        }
    } else if ("files" in items && items.files) {
        for (let i = 0; i < items.files.length; i++) {
            const file = items.files[i];
            results.push({ file, path: file.name });
        }
    }

    if (entries.length > 0) {
        for (const entry of entries) {
            await readEntry(entry, "", results);
        }
    }

    return results;
}

async function readEntry(entry: any, basePath: string, results: AssetFileEntry[]): Promise<void> {
    if (!entry) return;
    if (entry.isFile) {
        await new Promise<void>((resolve) => {
            entry.file(
                (file: File) => {
                    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
                    const folder = basePath ? basePath.split("/")[0] : undefined;
                    results.push({ file, path: relativePath, folder });
                    resolve();
                },
                () => resolve(),
            );
        });
    } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readEntries = async (): Promise<any[]> => {
            return new Promise((resolve) => {
                dirReader.readEntries(
                    (batch: any[]) => resolve(batch),
                    () => resolve([]),
                );
            });
        };

        const currentDir = basePath ? `${basePath}/${entry.name}` : entry.name;
        while (true) {
            const batch = await readEntries();
            if (!batch || batch.length === 0) break;
            for (const child of batch) {
                await readEntry(child, currentDir, results);
            }
        }
    }
}
