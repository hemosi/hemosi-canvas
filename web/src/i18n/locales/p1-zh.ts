// Part-one (foundation nodes & canvas) strings. Chinese only; en-US falls back to these.
const p1 = {
    node: {
        lockedSkip: "{{count}} 个节点已锁定，未删除（先解锁）",
        deleteLinkedTitle: "删除 {{count}} 个节点？",
        deleteLinkedBody: "这些节点还连着 {{count}} 条连线，删除后会一并断开：",
        deleteLinkedOk: "断开并删除",
        nothingToDownload: "这个节点没有可下载的内容",
    },
    link: {
        problem: "连线类型可能不对：{{problem}}",
        setKind: "标为「{{kind}}」",
        editLabel: "编辑连线标注",
        labelPlaceholder: "例如：动作参考 / 主角 / 第二场",
    },
    shot: {
        nothingToSplit: "没有可拆的文字（先写剧本，或在文本里选中一段）",
        scene: "场次",
        split: "已拆成 {{count}} 个分镜（镜头 {{from}}–{{to}}）",
        splitParagraph: "拆分镜·按段",
        splitParagraphTitle: "把选中的剧本（未选中则全文）按空行分段，每段一个分镜，描述自动填入",
        splitLine: "拆分镜·按行",
        splitLineTitle: "按行拆，每行一个分镜",
    },
    toolbar: {
        setRef: "设为参考",
        setRefTitle: "把这张图作为参考连给某个生成节点/分镜",
        ratioLockTitle: "切换：保持比例 / 自由拉伸",
        ratioLocked: "比例锁定",
        freeResize: "自由拉伸",
    },
    versions: {
        title: "历史版本：对比 / 还原",
        button: "版本 {{count}}",
    },
    menu: {
        duplicate: "复制",
        duplicateWithLinks: "带连线复制",
        lock: "锁定",
        unlock: "解锁",
        collapse: "折叠",
        expand: "展开",
        download: "下载内容",
    },
};

export default p1;
