//!HOOK RGB
//!BIND HOOKED
//!DESC Chroma shuffle (GPU equivalent of FFmpeg hue=h=12 + eq=saturation=1.25)

vec4 hook() {
    vec4 c = HOOKED_texOff(0);

    // === hue=h=12 (rotate hue 12 degrees) ===
    // Convert 12 degrees to radians
    float angle = 12.0 * 3.14159265 / 180.0;
    float cosA = cos(angle);
    float sinA = sin(angle);

    // Hue rotation matrix (Pregibon method — rotates in RGB space around (1,1,1) axis)
    float oneThird = 1.0 / 3.0;
    float rotSqrt = sqrt(oneThird);
    mat3 hueRot = mat3(
        cosA + (1.0 - cosA) * oneThird,
        oneThird * (1.0 - cosA) - rotSqrt * sinA,
        oneThird * (1.0 - cosA) + rotSqrt * sinA,

        oneThird * (1.0 - cosA) + rotSqrt * sinA,
        cosA + (1.0 - cosA) * oneThird,
        oneThird * (1.0 - cosA) - rotSqrt * sinA,

        oneThird * (1.0 - cosA) - rotSqrt * sinA,
        oneThird * (1.0 - cosA) + rotSqrt * sinA,
        cosA + (1.0 - cosA) * oneThird
    );
    c.rgb = hueRot * c.rgb;

    // === eq=saturation=1.25 ===
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(luma), c.rgb, 1.25);

    return clamp(c, 0.0, 1.0);
}
