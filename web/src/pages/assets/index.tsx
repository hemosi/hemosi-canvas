import { Copy, Download, Folder, FolderPlus, FolderTree, Heart, PencilLine, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { App, Button, Drawer, Empty, Form, Image, Input, Modal, Pagination, Select, Space, Tag, Typography } from "antd";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { useCopyText } from "@/hooks/use-copy-text";
import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { getImageBlob, getImagePreviewRevision, subscribeImagePreviews, uploadImage } from "@/services/image-storage";
import { cn } from "@/lib/utils";
import { getFilesFromDataTransfer } from "@/lib/asset-folder-drop";
import { assetCoverUrl, useAssetStore, type Asset, type AssetCategory, type AssetKind, type ImageAsset, type SubjectFolder } from "@/stores/use-asset-store";
import { exportAssets, readAssetPackage } from "./asset-transfer";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    category?: AssetCategory;
    folder?: string;
    source?: string;
    note?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;

const kindOptions = ["all", "text", "image", "video"] as const;

export const SUBJECT_FOLDERS: { key: SubjectFolder; label: string }[] = [
    { key: "character", label: "角色" },
    { key: "scene", label: "场景" },
    { key: "prop", label: "道具" },
    { key: "style", label: "风格" },
    { key: "sound", label: "音效" },
    { key: "other", label: "其他" },
];

export default function AssetsPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const copyText = useCopyText();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const assetInputRef = useRef<HTMLInputElement>(null);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const removeAsset = useAssetStore((state) => state.removeAsset);

    const [activeNav, setActiveNav] = useState<string>("all"); // "all" | "favorite" | "subject" | "folder:character" etc.
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(24);
    const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
    const [isAssetOpen, setIsAssetOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [deletingAsset, setDeletingAsset] = useState<Asset | null>(null);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [isDraggingOverNav, setIsDraggingOverNav] = useState<string | null>(null);

    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";
    const validAssets = useMemo(() => assets.filter((asset) => asset.kind === "text" || asset.kind === "image" || asset.kind === "video"), [assets]);

    const filteredAssets = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return validAssets.filter((asset) => {
            if (activeNav === "favorite") {
                if (asset.category !== "favorite") return false;
            } else if (activeNav === "subject") {
                if (asset.category !== "subject") return false;
            } else if (activeNav.startsWith("folder:")) {
                const folderKey = activeNav.replace("folder:", "");
                const folderObj = SUBJECT_FOLDERS.find((f) => f.key === folderKey);
                const matchesFolder = asset.folder === folderKey || Boolean(folderObj && asset.folder === folderObj.label);
                if (!matchesFolder) return false;
            }

            if (kindFilter !== "all" && asset.kind !== kindFilter) return false;
            if (!query) return true;
            return assetSearchText(asset).includes(query);
        });
    }, [validAssets, activeNav, kindFilter, keyword]);

    const visibleAssets = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredAssets.slice(start, start + pageSize);
    }, [filteredAssets, page, pageSize]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
        setPage((value) => Math.min(value, maxPage));
    }, [filteredAssets.length, pageSize]);

    const openCreate = () => {
        setEditingAsset(null);
        setImageDraft(null);
        setFormKind("text");
        let defCat: AssetCategory = "other";
        let defFolder: string | undefined = undefined;
        if (activeNav === "favorite") defCat = "favorite";
        else if (activeNav === "subject") defCat = "subject";
        else if (activeNav.startsWith("folder:")) {
            defCat = "subject";
            defFolder = activeNav.replace("folder:", "");
        }
        form.setFieldsValue({ kind: "text", title: "", coverUrl: "", tags: [], category: defCat, folder: defFolder, source: t("assets.manual"), note: "", content: "" });
        setIsAssetOpen(true);
    };

    const openEdit = (asset: Asset) => {
        setEditingAsset(asset);
        setFormKind(asset.kind);
        setImageDraft(asset.kind === "image" ? asset.data : null);
        form.setFieldsValue({
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            category: asset.category,
            folder: asset.folder,
            source: asset.source,
            note: asset.note,
            content: asset.kind === "text" ? asset.data.content : "",
        });
        setIsAssetOpen(true);
    };

    const saveAsset = async () => {
        const values = await form.validateFields();
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: values.tags || [],
            category: values.category,
            folder: values.folder,
            source: values.source?.trim(),
            note: values.note?.trim(),
            metadata: editingAsset?.metadata || { source: "manual" },
        };

        if (values.kind === "text") {
            const asset = { ...base, kind: "text" as const, data: { content: (values.content || "").trim() } };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        } else {
            if (!imageDraft) {
                message.error(t("assets.selectImage"));
                return;
            }
            const asset = { ...base, kind: "image" as const, data: imageDraft };
            editingAsset ? updateAsset(editingAsset.id, asset) : addAsset(asset);
        }

        message.success(editingAsset ? t("assets.updated") : t("assets.saved"));
        setIsAssetOpen(false);
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        form.setFieldValue("coverUrl", dataUrl);
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const image = await uploadImage(file);
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
    };

    const copyAssetText = async (asset: Asset) => {
        if (asset.kind !== "text") return;
        copyText(asset.data.content, t("assets.textCopied"));
    };

    const downloadImage = async (asset: Asset) => {
        if (asset.kind !== "image" && asset.kind !== "video") return;
        try {
            const blob = await readAssetMediaBlob(asset);
            if (!blob) {
                message.error(t("assets.downloadFailed"));
                return;
            }
            const ext = asset.data.mimeType?.split("/")[1]?.split("+")[0] || (asset.kind === "video" ? "mp4" : "png");
            saveAs(blob, `${asset.title || "asset"}.${ext}`);
        } catch {
            message.error(t("assets.downloadFailed"));
        }
    };

    const exportAllAssets = async () => {
        if (!validAssets.length) {
            message.warning(t("assets.noneToExport"));
            return;
        }
        await exportAssets(validAssets, t("assets.packageName"));
    };

    const importAssetZip = async (file?: File) => {
        if (!file) return;
        try {
            const importedAssets = await readAssetPackage(file);
            importedAssets.forEach((asset) => {
                const payload = { ...asset } as Record<string, unknown>;
                delete payload.id;
                delete payload.createdAt;
                delete payload.updatedAt;
                addAsset(payload as Parameters<typeof addAsset>[0]);
            });
            message.success(t("assets.imported", { count: importedAssets.length }));
        } catch {
            message.error(t("assets.importFailed"));
        } finally {
            if (assetInputRef.current) assetInputRef.current.value = "";
        }
    };

    const confirmDelete = () => {
        if (!deletingAsset) return;
        removeAsset(deletingAsset.id);
        message.success(t("assets.deleted"));
        setDeletingAsset(null);
    };

    const toggleFavorite = (asset: Asset) => {
        const next = asset.category === "favorite" ? "other" : "favorite";
        updateAsset(asset.id, { category: next });
    };

    // 文件夹/文件拖拽入库 或 已有素材卡片拖拽归类
    const handleDropInFolder = async (event: React.DragEvent, targetNavKey: string) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDraggingOverNav(null);

        const draggedAssetId = event.dataTransfer.getData("application/x-hemosi-asset-id");
        if (draggedAssetId) {
            if (targetNavKey === "favorite") {
                updateAsset(draggedAssetId, { category: "favorite" });
                message.success("已移入「收藏」");
            } else if (targetNavKey === "subject") {
                updateAsset(draggedAssetId, { category: "subject" });
                message.success("已移入「主体库」");
            } else if (targetNavKey.startsWith("folder:")) {
                const folderKey = targetNavKey.replace("folder:", "");
                const label = SUBJECT_FOLDERS.find((f) => f.key === folderKey)?.label || folderKey;
                updateAsset(draggedAssetId, { category: "subject", folder: folderKey });
                message.success(`已归类到「${label}」`);
            } else {
                updateAsset(draggedAssetId, { category: "other", folder: undefined });
            }
            return;
        }

        const items = await getFilesFromDataTransfer(event.dataTransfer);
        if (!items.length) return;

        const hide = message.loading("正在入库拖拽文件…", 0);
        let count = 0;
        try {
            for (const item of items) {
                const file = item.file;
                const inferredFolder = item.folder || (targetNavKey.startsWith("folder:") ? targetNavKey.replace("folder:", "") : undefined);
                let targetCategory: AssetCategory = "other";
                if (targetNavKey === "favorite") targetCategory = "favorite";
                else if (targetNavKey === "subject" || inferredFolder) targetCategory = "subject";

                if (file.type.startsWith("image/")) {
                    const img = await uploadImage(file);
                    addAsset({
                        kind: "image",
                        title: file.name,
                        coverUrl: img.url,
                        tags: inferredFolder ? [inferredFolder] : [],
                        category: targetCategory,
                        folder: inferredFolder,
                        data: { dataUrl: img.url, storageKey: img.storageKey, width: img.width, height: img.height, bytes: img.bytes, mimeType: img.mimeType },
                    });
                    count++;
                } else if (file.type.startsWith("video/")) {
                    const vid = await uploadMediaFile(file, "video");
                    addAsset({
                        kind: "video",
                        title: file.name,
                        coverUrl: "",
                        tags: inferredFolder ? [inferredFolder] : [],
                        category: targetCategory,
                        folder: inferredFolder,
                        data: { url: vid.url, storageKey: vid.storageKey, width: vid.width || 0, height: vid.height || 0, bytes: vid.bytes, mimeType: vid.mimeType },
                    });
                    count++;
                }
            }
            if (count > 0) message.success(`已成功入库 ${count} 个素材`);
            else message.warning("未检测到支持的图片或视频文件");
        } catch (err) {
            console.error(err);
            message.error("入库失败，请重试");
        } finally {
            hide();
        }
    };

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-900 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-hidden flex bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(rgba(245,245,244,.14)_1px,transparent_1px)]">
                {/* 左栏分类与文件夹目录 */}
                <aside className="w-60 shrink-0 border-r border-stone-200/80 bg-stone-50/70 p-4 backdrop-blur dark:border-stone-800 dark:bg-stone-900/60 flex flex-col justify-between">
                    <div className="space-y-4">
                        <div className="px-2 pt-1">
                            <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">素材库分类</h2>
                            <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">支持直接从电脑拖拽文件夹入库</p>
                        </div>

                        <div className="space-y-1">
                            <NavItem
                                icon={<FolderTree className="size-4" />}
                                label="全部素材"
                                count={validAssets.length}
                                active={activeNav === "all"}
                                isDragOver={isDraggingOverNav === "all"}
                                onClick={() => setActiveNav("all")}
                                onDragOver={(e) => { e.preventDefault(); setIsDraggingOverNav("all"); }}
                                onDragLeave={() => setIsDraggingOverNav(null)}
                                onDrop={(e) => void handleDropInFolder(e, "all")}
                            />
                            <NavItem
                                icon={<Heart className="size-4 text-red-500" />}
                                label="收藏"
                                count={validAssets.filter((a) => a.category === "favorite").length}
                                active={activeNav === "favorite"}
                                isDragOver={isDraggingOverNav === "favorite"}
                                onClick={() => setActiveNav("favorite")}
                                onDragOver={(e) => { e.preventDefault(); setIsDraggingOverNav("favorite"); }}
                                onDragLeave={() => setIsDraggingOverNav(null)}
                                onDrop={(e) => void handleDropInFolder(e, "favorite")}
                            />
                            <NavItem
                                icon={<Folder className="size-4 text-amber-500" />}
                                label="主体库"
                                count={validAssets.filter((a) => a.category === "subject").length}
                                active={activeNav === "subject"}
                                isDragOver={isDraggingOverNav === "subject"}
                                onClick={() => setActiveNav("subject")}
                                onDragOver={(e) => { e.preventDefault(); setIsDraggingOverNav("subject"); }}
                                onDragLeave={() => setIsDraggingOverNav(null)}
                                onDrop={(e) => void handleDropInFolder(e, "subject")}
                            />
                        </div>

                        <div className="pt-2">
                            <div className="px-2 pb-1 text-xs font-semibold text-stone-400">主体库文件夹</div>
                            <div className="space-y-0.5 pl-2">
                                {SUBJECT_FOLDERS.map((folder) => {
                                    const navKey = `folder:${folder.key}`;
                                    const folderCount = validAssets.filter((a) => a.folder === folder.key || a.folder === folder.label).length;
                                    return (
                                        <NavItem
                                            key={folder.key}
                                            icon={<Folder className="size-3.5 text-stone-400" />}
                                            label={folder.label}
                                            count={folderCount}
                                            active={activeNav === navKey}
                                            isDragOver={isDraggingOverNav === navKey}
                                            onClick={() => setActiveNav(navKey)}
                                            onDragOver={(e) => { e.preventDefault(); setIsDraggingOverNav(navKey); }}
                                            onDragLeave={() => setIsDraggingOverNav(null)}
                                            onDrop={(e) => void handleDropInFolder(e, navKey)}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-stone-200/80 pt-3 dark:border-stone-800 space-y-2">
                        <Button block type="dashed" icon={<Plus className="size-3.5" />} onClick={openCreate} className="text-xs">
                            新建素材
                        </Button>
                    </div>
                </aside>

                {/* 右栏内容区 */}
                <section className="min-w-0 flex-1 overflow-y-auto px-6 py-6 flex flex-col">
                    <div className="pb-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-stone-950 dark:text-stone-100">
                                    {activeNav === "all" ? "全部素材" : activeNav === "favorite" ? "收藏" : activeNav === "subject" ? "主体库" : SUBJECT_FOLDERS.find(f => `folder:${f.key}` === activeNav)?.label || "素材列表"}
                                </h1>
                                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                                    瀑布流视图展示 · 显示原图比例与文件名
                                </p>
                            </div>

                            <div className="flex items-center gap-3">
                                <Input.Search
                                    className="w-64"
                                    size="middle"
                                    allowClear
                                    prefix={<Search className="size-3.5 text-stone-400" />}
                                    value={keyword}
                                    placeholder={t("assets.search")}
                                    onChange={(event) => {
                                        setPage(1);
                                        setKeyword(event.target.value);
                                    }}
                                />
                                <Button onClick={() => void exportAllAssets()}>{t("assets.export")}</Button>
                                <Button onClick={() => assetInputRef.current?.click()}>{t("assets.import")}</Button>
                                <Button type="primary" onClick={openCreate}>{t("assets.add")}</Button>
                            </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between">
                            <div className="flex flex-wrap gap-2">
                                {kindOptions.map((option) => (
                                    <Tag.CheckableTag
                                        key={option}
                                        checked={kindFilter === option}
                                        className={cn("prompt-filter-tag", kindFilter === option && "is-active")}
                                        onChange={() => {
                                            setPage(1);
                                            setKindFilter(option);
                                        }}
                                    >
                                        {option === "all" ? t("common.all") : t(`assets.kinds.${option}`)}
                                    </Tag.CheckableTag>
                                ))}
                            </div>
                            <span className="text-xs text-stone-400">共 {filteredAssets.length} 项素材</span>
                        </div>
                    </div>

                    {/* 瀑布流展示 (CSS Columns + break-inside-avoid) */}
                    <div className="flex-1">
                        {visibleAssets.length > 0 ? (
                            <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6 gap-4 space-y-4">
                                {visibleAssets.map((asset) => (
                                    <WaterfallAssetCard
                                        key={asset.id}
                                        asset={asset}
                                        onOpen={() => setPreviewAsset(asset)}
                                        onEdit={() => openEdit(asset)}
                                        onCopy={copyAssetText}
                                        onDownload={downloadImage}
                                        onDelete={() => setDeletingAsset(asset)}
                                        onToggleFavorite={() => toggleFavorite(asset)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("assets.empty")} className="py-24" />
                        )}
                    </div>

                    <div className="flex justify-center py-6">
                        <Pagination
                            current={page}
                            pageSize={pageSize}
                            total={filteredAssets.length}
                            showSizeChanger
                            pageSizeOptions={[24, 48, 96]}
                            onChange={(nextPage, nextPageSize) => {
                                setPage(nextPage);
                                setPageSize(nextPageSize);
                            }}
                        />
                    </div>
                </section>
            </main>

            <Modal title={editingAsset ? t("assets.edit") : t("assets.add")} open={isAssetOpen} width={980} onCancel={() => setIsAssetOpen(false)} onOk={() => void saveAsset()} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ kind: "text", tags: [], category: "other" }}>
                        <div className="grid grid-cols-3 gap-3">
                            <Form.Item name="kind" label={t("assets.type")}>
                                <Select
                                    options={[
                                        { label: t("assets.kinds.text"), value: "text" },
                                        { label: t("assets.kinds.image"), value: "image" },
                                    ]}
                                    onChange={(value) => setFormKind(value)}
                                />
                            </Form.Item>
                            <Form.Item name="category" label="分类归属">
                                <Select
                                    options={[
                                        { label: "未分类", value: "other" },
                                        { label: "收藏", value: "favorite" },
                                        { label: "主体库", value: "subject" },
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item name="folder" label="主体文件夹">
                                <Select
                                    allowClear
                                    placeholder="选择文件夹"
                                    options={SUBJECT_FOLDERS.map((f) => ({ label: f.label, value: f.key }))}
                                />
                            </Form.Item>
                        </div>
                        <Form.Item name="title" label={t("assets.fields.title")} rules={[{ required: true, message: t("assets.fields.titleRequired") }]}>
                            <Input size="large" placeholder={t("assets.fields.titlePlaceholder")} />
                        </Form.Item>
                        <Form.Item name="coverUrl" label={t("assets.fields.coverUrl")}>
                            <Space.Compact className="w-full">
                                <Input placeholder={t("assets.fields.coverPlaceholder")} />
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    {t("common.upload")}
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label={t("assets.fields.tags")}>
                            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder={t("assets.fields.tagsPlaceholder")} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="source" label={t("assets.fields.source")}>
                                <Input placeholder={t("assets.fields.sourcePlaceholder")} />
                            </Form.Item>
                            <Form.Item name="note" label={t("assets.fields.note")}>
                                <Input placeholder={t("assets.fields.optional")} />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label={t("assets.fields.textContent")} rules={[{ required: true, message: t("assets.fields.textRequired") }]}>
                                <Input.TextArea rows={8} placeholder={t("assets.fields.textPlaceholder")} />
                            </Form.Item>
                        ) : (
                            <Form.Item label={t("assets.fields.imageContent")} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Button icon={<Upload className="size-4" />} onClick={() => imageInputRef.current?.click()}>
                                        {t("assets.selectImageFile")}
                                    </Button>
                                    {imageDraft ? (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                        </Typography.Text>
                                    ) : (
                                        <Typography.Text type="secondary" className="ml-3 text-xs">
                                            {t("assets.noImageSelected")}
                                        </Typography.Text>
                                    )}
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>{t("assets.preview")}</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="w-full object-contain max-h-64" />
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || t("assets.noCover")}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || t("assets.untitled")}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">{t("assets.untagged")}</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

            <AssetDrawer asset={previewAsset} onClose={() => setPreviewAsset(null)} onCopy={copyAssetText} onDownload={downloadImage} />

            <input ref={assetInputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importAssetZip(event.target.files?.[0])} />

            <Modal title={t("assets.deleteTitle")} open={Boolean(deletingAsset)} onCancel={() => setDeletingAsset(null)} onOk={confirmDelete} okText={t("common.delete")} okButtonProps={{ danger: true }} cancelText={t("common.cancel")}>
                {t("assets.deleteConfirm", { name: deletingAsset?.title })}
            </Modal>
        </div>
    );
}

function NavItem({ icon, label, count, active, isDragOver, onClick, onDragOver, onDragLeave, onDrop }: { icon: React.ReactNode; label: string; count?: number; active: boolean; isDragOver?: boolean; onClick: () => void; onDragOver?: (e: React.DragEvent) => void; onDragLeave?: () => void; onDrop?: (e: React.DragEvent) => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
                "group flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition cursor-pointer text-left",
                active ? "bg-amber-500/10 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400 font-semibold" : "text-stone-600 hover:bg-stone-200/50 dark:text-stone-300 dark:hover:bg-stone-800/60",
                isDragOver && "ring-2 ring-amber-500 bg-amber-500/20",
            )}
        >
            <div className="flex items-center gap-2 truncate">
                {icon}
                <span className="truncate">{label}</span>
            </div>
            {typeof count === "number" ? <span className="text-[11px] opacity-50 tabular-nums">{count}</span> : null}
        </button>
    );
}

function WaterfallAssetCard({
    asset,
    onOpen,
    onEdit,
    onCopy,
    onDownload,
    onDelete,
    onToggleFavorite,
}: {
    asset: Asset;
    onOpen: () => void;
    onEdit: () => void;
    onCopy: (asset: Asset) => void;
    onDownload: (asset: Asset) => void;
    onDelete: () => void;
    onToggleFavorite: () => void;
}) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = assetCoverUrl(asset);
    const isFav = asset.category === "favorite";

    return (
        <div
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData("application/x-hemosi-asset-id", asset.id);
                e.dataTransfer.effectAllowed = "move";
            }}
            className="group break-inside-avoid rounded-xl border border-stone-200/90 bg-white shadow-sm transition hover:shadow-md dark:border-stone-800 dark:bg-stone-900/90 overflow-hidden flex flex-col cursor-grab active:cursor-grabbing"
        >
            <div className="relative cursor-pointer overflow-hidden bg-stone-100 dark:bg-stone-950" onClick={onOpen}>
                {cover ? (
                    <img src={cover} alt={asset.title} className="w-full h-auto object-contain transition duration-200 group-hover:scale-[1.02]" loading="lazy" />
                ) : (
                    <div className="p-4 text-xs leading-5 text-stone-600 dark:text-stone-300 max-h-48 overflow-hidden">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                )}
                <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
                        className={cn("p-1.5 rounded-full backdrop-blur shadow-sm", isFav ? "bg-red-500 text-white" : "bg-white/80 text-stone-700 hover:text-red-500 dark:bg-stone-900/80 dark:text-stone-200")}
                        title={isFav ? "取消收藏" : "收藏"}
                    >
                        <Heart className="size-3.5" fill={isFav ? "currentColor" : "none"} />
                    </button>
                </div>
            </div>

            {/* 文件名/素材名及操作 */}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-1.5">
                    <h3 className="truncate text-xs font-medium text-stone-900 dark:text-stone-100" title={asset.title}>
                        {asset.title}
                    </h3>
                    <Tag className="m-0 shrink-0 text-[10px] px-1 py-0">{t(`assets.kinds.${asset.kind}`)}</Tag>
                </div>

                {asset.folder ? (
                    <div className="mt-1">
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10 px-1 py-0.5 rounded">
                            {SUBJECT_FOLDERS.find(f => f.key === asset.folder)?.label || asset.folder}
                        </span>
                    </div>
                ) : null}

                <div className="mt-2 flex items-center justify-between border-t border-stone-100 pt-1.5 dark:border-stone-800/80">
                    <span className="text-[10px] text-stone-400">
                        {asset.kind === "image" ? `${asset.data.width}×${asset.data.height}` : asset.kind === "video" ? `${asset.data.width}×${asset.data.height}` : `${asset.data.content.length} 字`}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                        {asset.kind !== "video" ? (
                            <button type="button" onClick={onEdit} className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200" title="编辑">
                                <PencilLine className="size-3" />
                            </button>
                        ) : null}
                        {asset.kind === "text" ? (
                            <button type="button" onClick={() => void onCopy(asset)} className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200" title="复制">
                                <Copy className="size-3" />
                            </button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <button type="button" onClick={() => onDownload(asset)} className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200" title="下载">
                                <Download className="size-3" />
                            </button>
                        ) : null}
                        <button type="button" onClick={onDelete} className="p-1 text-stone-400 hover:text-red-500" title="删除">
                            <Trash2 className="size-3" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: Asset | null; onClose: () => void; onCopy: (asset: Asset) => void; onDownload: (asset: Asset) => void }) {
    const { t } = useTranslation();
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const cover = asset ? asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") : "";
    return (
        <Drawer title={t("assets.details")} open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-5">
                    {cover ? (
                        <Image src={assetCoverUrl(asset)} preview={{ src: cover }} alt={asset.title} className="rounded-lg object-contain max-h-[500px]" />
                    ) : (
                        <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 text-sm leading-6 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300">{asset.kind === "text" ? asset.data.content : t("assets.noCover")}</div>
                    )}
                    <div>
                        <Typography.Title level={4} className="!mb-2">
                            {asset.title}
                        </Typography.Title>
                        <Space size={[4, 4]} wrap>
                            <Tag>{t(`assets.kinds.${asset.kind}`)}</Tag>
                            {asset.category === "favorite" ? <Tag color="error">收藏</Tag> : null}
                            {asset.category === "subject" ? <Tag color="warning">主体库</Tag> : null}
                            {asset.folder ? <Tag color="blue">{SUBJECT_FOLDERS.find(f => f.key === asset.folder)?.label || asset.folder}</Tag> : null}
                            {(asset.tags || []).map((tag) => (
                                <Tag key={tag}>{tag}</Tag>
                            ))}
                        </Space>
                    </div>
                    <div className="rounded-lg border border-stone-200 p-4 dark:border-stone-800">
                        <Typography.Text type="secondary" className="block text-xs">
                            {t("assets.fields.textContent")}
                        </Typography.Text>
                        {asset.kind === "text" ? (
                            <Typography.Paragraph className="mt-2 whitespace-pre-wrap">{asset.data.content}</Typography.Paragraph>
                        ) : asset.kind === "video" ? (
                            <video src={asset.data.url} controls className="mt-2 aspect-video w-full rounded-lg bg-black" />
                        ) : (
                            <Typography.Text className="mt-2 block">
                                {asset.data.width}x{asset.data.height} · {formatBytes(asset.data.bytes)} · {asset.data.mimeType}
                            </Typography.Text>
                        )}
                    </div>
                    {asset.note ? (
                        <div>
                            <Typography.Text type="secondary">{t("assets.fields.note")}</Typography.Text>
                            <Typography.Paragraph className="mt-1">{asset.note}</Typography.Paragraph>
                        </div>
                    ) : null}
                    <Space>
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                {t("assets.copyText")}
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {asset.kind === "video" ? t("assets.downloadVideo") : t("assets.downloadImage")}
                            </Button>
                        ) : null}
                    </Space>
                </div>
            ) : null}
        </Drawer>
    );
}

async function readAssetMediaBlob(asset: Extract<Asset, { kind: "image" | "video" }>) {
    const storageKey = asset.data.storageKey;
    if (storageKey) {
        const stored = asset.kind === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (stored) return stored;
    }
    const url = asset.kind === "video" ? asset.data.url : asset.data.dataUrl || asset.coverUrl;
    if (!url) return null;
    const response = await fetch(url);
    return response.ok ? response.blob() : null;
}

function assetSearchText(asset: Asset) {
    return [asset.title, asset.source || "", asset.note || "", (asset.tags || []).join(" "), asset.folder || "", asset.category || "", asset.kind === "text" ? asset.data.content : asset.data.mimeType].join(" ").toLowerCase();
}
