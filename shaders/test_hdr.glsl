//!HOOK RGB
//!BIND HOOKED
//!DESC HDR-like enhancement (contrast + saturation + brightness)

vec4 hook() {
    vec4 c = HOOKED_texOff(0);
    // Brightness +0.01
    c.rgb += 0.01;
    // Contrast 1.10
    c.rgb = (c.rgb - 0.5) * 1.10 + 0.5;
    // Saturation 1.10
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(luma), c.rgb, 1.10);
    return c;
}
