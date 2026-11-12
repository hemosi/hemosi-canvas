/** Canvas keyboard shortcuts as handled in pages/canvas/project.tsx (Mod = Ctrl on Windows, ⌘ on macOS). */
export const CANVAS_SHORTCUTS: { group: string; items: { keys: string[]; action: string }[] }[] = [
    {
        group: "模式与导航",
        items: [
            { keys: ["Shift（单按）"], action: "切换「移动画布（小手）」↔「框选模式（箭头）」" },
            { keys: ["Shift / Space", "拖动"], action: "临时切换框选 / 平移画布" },
            { keys: ["滚轮"], action: "以鼠标为中心无极缩放画布" },
            { keys: ["1 ~ 9 / 字母"], action: "一键跳转到对应「书签」节点（重置 100% 视野）" },
            { keys: ["Mod", "F"], action: "搜索节点并定位高亮" },
            { keys: ["双击空白处"], action: "在鼠标处弹出新建节点菜单" },
            { keys: ["?"], action: "打开本快捷键清单" },
        ],
    },
    {
        group: "节点与全屏预览",
        items: [
            { keys: ["Alt", "拖动节点"], action: "按住 Alt 拖拽快速复制节点或编组" },
            { keys: ["双击图片/视频"], action: "打开无边框全屏预览（全屏按 I 查看详情）" },
            { keys: ["Mod", "C"], action: "复制选中节点" },
            { keys: ["Mod", "V"], action: "粘贴节点（支持直接粘贴系统剪贴板图片/文字）" },
            { keys: ["Mod", "D"], action: "复制节点（不带连线）" },
            { keys: ["Mod", "Shift", "D"], action: "带连线复制节点" },
            { keys: ["Delete / Backspace"], action: "删除选中节点或连线" },
            { keys: ["Mod", "L"], action: "锁定 / 解锁选中节点" },
            { keys: ["Mod", "Shift", "C"], action: "折叠 / 展开选中节点" },
        ],
    },
    {
        group: "批量选择、连线与编组",
        items: [
            { keys: ["多选框右侧 +"], action: "拖拽或点击可将全部选中节点同时连线到右侧节点" },
            { keys: ["Mod", "A"], action: "全选画布节点" },
            { keys: ["Shift", "点击节点"], action: "加选 / 减选单个节点" },
            { keys: ["Mod", "G"], action: "将选中节点打组" },
            { keys: ["Mod", "Shift", "G"], action: "解散编组" },
            { keys: ["Mod", "Shift", "L"], action: "一键自动整理对齐布局" },
            { keys: ["Esc"], action: "取消选择 / 退出全屏或弹窗" },
        ],
    },
    {
        group: "历史记录（含 3D 导演台）",
        items: [
            { keys: ["Mod", "Z"], action: "撤销上一步操作" },
            { keys: ["Mod", "Shift", "Z"], action: "重做" },
            { keys: ["Mod", "Y"], action: "重做" },
        ],
    },
];

export function shortcutKeyLabel(key: string) {
    if (key !== "Mod") return key;
    return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
