// A picture-book colour grade on top of Khronos Neutral tone mapping: shadows lifted toward
// blue-violet, warm golden highlights and a touch more richness. Installed as three's CustomToneMapping, so every material drawn by
// the world's renderer (terrain, sea, pieces) is graded the same way.

import * as THREE from 'three'

export const GRADE_GLSL = /* glsl */ `
vec3 worldGrade( vec3 c ) {
  vec3 g = pow( max( c, 0.0 ), vec3( 1.0 / 2.2 ) );
  float l = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Picture-book split tone: shadows lifted toward blue-violet, highlights warm and golden.
  float sh = 1.0 - smoothstep( 0.04, 0.6, l );
  g = g * ( 1.0 - 0.05 * sh ) + vec3( 0.036, 0.026, 0.066 ) * sh;
  g += vec3( 0.026, 0.012, -0.022 ) * smoothstep( 0.42, 0.95, l );
  // A little more richness in the midtones.
  g = mix( vec3( l ), g, 1.1 );
  return pow( clamp( g, 0.0, 1.0 ), vec3( 2.2 ) );
}
`

let installed = false

export function installGrade() {
  if (installed) return
  installed = true
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment
  const stub = 'vec3 CustomToneMapping( vec3 color ) { return color; }'
  if (!chunk.includes(stub)) return
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(
    stub,
    `${GRADE_GLSL}\nvec3 CustomToneMapping( vec3 color ) { return worldGrade( NeutralToneMapping( color ) ); }`,
  )
}
