// A gentle colour grade on top of Khronos Neutral tone mapping: cooler shadows, warmer highlights
// and a touch more richness. Installed as three's CustomToneMapping, so every material drawn by
// the world's renderer (terrain, sea, pieces) is graded the same way.

import * as THREE from 'three'

export const GRADE_GLSL = /* glsl */ `
vec3 worldGrade( vec3 c ) {
  vec3 g = pow( max( c, 0.0 ), vec3( 1.0 / 2.2 ) );
  float l = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
  g += vec3( -0.012, 0.0, 0.02 ) * ( 1.0 - smoothstep( 0.05, 0.55, l ) );
  g += vec3( 0.018, 0.007, -0.016 ) * smoothstep( 0.45, 0.95, l );
  g = mix( vec3( l ), g, 1.07 );
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
