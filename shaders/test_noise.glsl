//!HOOK RGB
//!BIND HOOKED
//!DESC Add film grain noise on GPU

vec4 hook() {
    vec4 color = HOOKED_texOff(0);
    // random is a per-frame pseudo-random float [0,1)
    // Mix with position for per-pixel variation
    float noise = (random - 0.5) * 0.04;
    color.rgb += vec3(noise);
    return color;
}
