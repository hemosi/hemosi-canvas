/** Canvas keyboard shortcuts as handled in pages/canvas/project.tsx (Mod = Ctrl on Windows, ⌘ on macOS). */
export const CANVAS_SHORTCUTS: { group: string; items: { keys: string[]; action: string }[] }[] = [
    {
        group: "节点",
        items: [
            { keys: ["Mod", "C"], action: "复制选中节点" },
            { keys: ["Mod", "V"], action: "粘贴节点（剪贴板是图片/文字时直接建节点）" },
            { keys: ["Mod", "D"], action: "复制节点（不带连线）" },
            { keys: ["Mod", "Shift", "D"], action: "带连线复制" },
            { keys: ["Delete"], action: "删除选中（有连线时先提示断链）" },
            { keys: ["Backspace"], action: "删除选中" },
            { keys: ["Mod", "L"], action: "锁定 / 解锁选中节点" },
            { keys: ["Mod", "Shift", "C"], action: "折叠 / 展开选中节点" },
        ],
    },
    {
        group: "选择与编组",
        items: [
            { keys: ["Mod", "A"], action: "全选" },
            { keys: ["Shift", "点击"], action: "加选 / 减选" },
            { keys: ["拖动空白处"], action: "框选（选择工具下）" },
            { keys: ["Mod", "G"], action: "编组" },
            { keys: ["Mod", "Shift", "G"], action: "取消编组" },
            { keys: ["Esc"], action: "取消选择 / 关闭弹层" },
        ],
    },
    {
        group: "历史",
        items: [
            { keys: ["Mod", "Z"], action: "撤销（含建节点、连线、删除）" },
            { keys: ["Mod", "Shift", "Z"], action: "重做" },
            { keys: ["Mod", "Y"], action: "重做" },
        ],
    },
    {
        group: "导航与整理",
        items: [
            { keys: ["Mod", "F"], action: "搜索节点并定位高亮" },
            { keys: ["Mod", "Shift", "L"], action: "一键整理布局（选中节点；未选中则整张画布）" },
            { keys: ["Space", "拖动"], action: "平移画布" },
            { keys: ["Mod", "滚轮"], action: "缩放" },
            { keys: ["双击空白处"], action: "新建节点菜单" },
            { keys: ["?"], action: "打开快捷键清单" },
        ],
    },
];

export function shortcutKeyLabel(key: string) {
    if (key !== "Mod") return key;
    return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
