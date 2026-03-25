//!HOOK RGB
//!BIND HOOKED
//!DESC RGB channel shift (GPU equivalent of FFmpeg rgbashift=rh=-3:rv=1:bh=3:bv=-1)

vec4 hook() {
    // Sample each channel from offset positions
    // rh=-3, rv=1: red shifted left 3px, down 1px
    // gh=0, gv=0: green stays
    // bh=3, bv=-1: blue shifted right 3px, up 1px
    float r = HOOKED_texOff(vec2(-3.0,  1.0)).r;
    float g = HOOKED_texOff(vec2( 0.0,  0.0)).g;
    float b = HOOKED_texOff(vec2( 3.0, -1.0)).b;

    return vec4(r, g, b, 1.0);
}
