/** Per-node camera settings. Every set field ends up in the generation request (prompt block, plus native params where a vendor has one). */
export type CameraSettings = {
    /** Camera body / film stock look, e.g. "arri-alexa-35". */
    body?: string;
    /** Lens family, e.g. "anamorphic". */
    lens?: string;
    /** Focal length in mm. */
    focalLength?: number;
    /** Aperture f-number, e.g. 2.8. */
    aperture?: number;
    /** Camera angle, e.g. "low". */
    angle?: string;
    /** Shot size, e.g. "close-up". */
    shotSize?: string;
    /** Camera move, e.g. "push-in"; "static" = locked-off camera. */
    movement?: string;
    movementSpeed?: "slow" | "medium" | "fast";
};

export type LightSource = { enabled?: boolean; direction?: string; intensity?: number; quality?: "soft" | "hard"; color?: string };

/** Lighting setup. Lives on a node, a group (whole scene) or a scene anchor; every shot that resolves to it gets the same block. */
export type LightingSettings = {
    /** Overall exposure -100 (very dark) … 100 (very bright); 0 = neutral. */
    brightness?: number;
    /** Colour temperature in Kelvin. */
    colorTemp?: number;
    key?: LightSource;
    rim?: LightSource;
    /** Overall look, e.g. "low-key". */
    mood?: string;
    note?: string;
};
