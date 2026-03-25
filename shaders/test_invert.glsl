//!HOOK RGB
//!BIND HOOKED
//!DESC Test invert colors - verify libplacebo shader works

vec4 hook() {
    vec4 color = HOOKED_texOff(0);
    color.rgb = vec3(1.0) - color.rgb;
    return color;
}
