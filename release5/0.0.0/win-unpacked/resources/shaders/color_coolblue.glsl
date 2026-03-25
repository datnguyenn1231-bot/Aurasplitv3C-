//!HOOK RGB
//!BIND HOOKED
//!DESC Cool blue grading (GPU equivalent of FFmpeg cool_blue preset)

vec4 hook() {
    vec4 c = HOOKED_texOff(0);

    // eq=saturation=1.05:gamma_b=1.10:gamma_r=0.92
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = mix(vec3(luma), c.rgb, 1.05);
    c.b = pow(c.b, 1.0 / 1.10);  // gamma_b=1.10 (boost blue)
    c.r = pow(c.r, 1.0 / 0.92);  // gamma_r=0.92 (reduce red)

    // curves: blue shadow lift, red highlight cut
    c.b = 0.03 + c.b * 0.97;
    c.r *= 0.95;

    // colorbalance: bs=0.05 rs=-0.03
    c.b += 0.05 * (1.0 - c.b);
    c.r -= 0.03 * c.r;

    return clamp(c, 0.0, 1.0);
}
