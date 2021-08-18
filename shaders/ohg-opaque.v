precision highp float;

attribute vec2 a_position;
attribute vec2 a_texcoord;

uniform vec2 u_resolution;
uniform mat3 u_matrix;

varying vec2 v_texcoord;
varying vec2 v_position;

void main() {
  vec2 position = (u_matrix * vec3(a_position, 1)).xy;
  position = 2.0*position / u_resolution - 1.0;

  v_texcoord = a_texcoord;
  v_position = position;
  gl_Position = vec4(position.x, position.y, 0.0, 1.0);
}