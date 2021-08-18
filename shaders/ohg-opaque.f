precision highp float;

varying vec2 v_texcoord;
varying vec2 v_position;

uniform vec2 u_resolution;

uniform sampler2D u_texture;

void main() {
   gl_FragColor = texture2D(u_texture, v_texcoord);//vec4(fract(v_texcoord.x), fract(v_texcoord.y), 0.0, 1.0);
}