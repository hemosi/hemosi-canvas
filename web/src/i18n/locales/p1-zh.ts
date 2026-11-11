// Part-one (foundation nodes & canvas) strings. Chinese only; en-US falls back to these.
const p1 = {
    node: {
        lockedSkip: "{{count}} 个节点已锁定，未删除（先解锁）",
        deleteLinkedTitle: "删除 {{count}} 个节点？",
        deleteLinkedBody: "这些节点还连着 {{count}} 条连线，删除后会一并断开：",
        deleteLinkedOk: "断开并删除",
        nothingToDownload: "这个节点没有可下载的内容",
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
