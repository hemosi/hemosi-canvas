import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

// Hemosi palette: dark neutral surfaces with one cyan accent (keep in sync with --hemosi-accent in globals.css).
const neutral = {
    light: {
        primary: "#009e9e",
        primaryHover: "#00b3b3",
        primaryText: "#ffffff",
        bgBase: "#ffffff",
        containerBg: "#ffffff",
        layoutBg: "#f7f7f8",
        elevatedBg: "#ffffff",
        itemHoverBg: "rgba(23, 23, 23, 0.06)",
        itemSelectedBg: "rgba(0, 158, 158, 0.12)",
        itemSelectedHoverBg: "rgba(0, 158, 158, 0.18)",
        itemText: "#171717",
        selectedText: "#007f7f",
        tableSelectedBg: "rgba(0, 158, 158, 0.06)",
        tableSelectedHoverBg: "rgba(0, 158, 158, 0.1)",
    },
    dark: {
        primary: "#00c8c8",
        primaryHover: "#2ee0e0",
        primaryText: "#0f1012",
        bgBase: "#0f1012",
        containerBg: "#17181b",
        layoutBg: "#0f1012",
        elevatedBg: "#1c1d21",
        itemHoverBg: "rgba(250, 250, 249, 0.07)",
        itemSelectedBg: "rgba(0, 200, 200, 0.14)",
        itemSelectedHoverBg: "rgba(0, 200, 200, 0.2)",
        itemText: "#fafafa",
        selectedText: "#00c8c8",
        tableSelectedBg: "rgba(0, 200, 200, 0.08)",
        tableSelectedHoverBg: "rgba(0, 200, 200, 0.12)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "hemosi-dark" : "hemosi-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgBase: color.bgBase,
            colorBgContainer: color.containerBg,
            colorBgLayout: color.layoutBg,
            colorBgElevated: color.elevatedBg,
            borderRadius: 8,
            controlItemBgHover: color.itemHoverBg,
            controlItemBgActive: color.itemSelectedBg,
            controlItemBgActiveHover: color.itemSelectedHoverBg,
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Dropdown: {
                colorBgElevated: color.elevatedBg,
                colorText: color.itemText,
                controlItemBgHover: color.itemHoverBg,
                controlItemBgActive: color.itemSelectedBg,
                controlItemBgActiveHover: color.itemSelectedHoverBg,
            },
            Menu: {
                popupBg: color.elevatedBg,
                itemActiveBg: color.itemSelectedBg,
                itemHoverBg: color.itemHoverBg,
                itemSelectedBg: color.itemSelectedBg,
                itemSelectedColor: color.selectedText,
                darkPopupBg: neutral.dark.elevatedBg,
                darkItemHoverBg: neutral.dark.itemHoverBg,
                darkItemSelectedBg: neutral.dark.itemSelectedBg,
                darkItemSelectedColor: neutral.dark.selectedText,
            },
            Select: {
                optionActiveBg: color.itemHoverBg,
                optionSelectedBg: color.itemSelectedBg,
                optionSelectedColor: color.selectedText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
