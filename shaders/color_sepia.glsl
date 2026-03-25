//!HOOK RGB
//!BIND HOOKED
//!DESC Sepia warm tone (GPU equivalent of FFmpeg sepia preset)

vec4 hook() {
    vec4 c = HOOKED_texOff(0);

    // colortemperature=temperature=8000 (warm shift)
    // Approximate: boost red, reduce blue
    c.r *= 1.06;
    c.b *= 0.92;

    // eq=brightness=0.08:contrast=1.05:saturation=0.95:gamma=1.1
    c.rgb += 0.08;
    c.rgb = (c.rgb - 0.5) * 1.05 + 0.5;
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(luma), c.rgb, 0.95);
    c.rgb = pow(c.rgb, vec3(1.0 / 1.1));

    // curves: red lift shadows, blue cut highlights
    c.r = 0.05 + c.r * 0.95;
    c.b *= 0.92;

    // colorbalance: rs=0.05 bs=-0.08
    c.r += 0.05 * (1.0 - c.r);
    c.b -= 0.08 * c.b;

    // vignette=angle=PI/4:a=0.3
    vec2 uv = gl_FragCoord.xy / input_size - 0.5;
    float dist = length(uv) * 2.0;
    float vignette = 1.0 - dist * dist * 0.3;
    c.rgb *= vignette;

    return clamp(c, 0.0, 1.0);
}
