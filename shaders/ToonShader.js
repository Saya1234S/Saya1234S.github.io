import * as THREE from 'three';

// -------------------------------------------------------------------
// Vertex Shader
// Computes tangent-space light & eye directions, UV, and edge offset
// -------------------------------------------------------------------
export const toonVertexShader = /* glsl */ `
uniform float edgeWidthRatio;
uniform bool  edge;
uniform vec3  lightDirection;
// uniform vec3 cameraPosition; // Provided by Three.js <common> chunk

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vLightDirection;
varying vec3 vWorldPos;

#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

void main() {
    vUv = uv;

    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>

    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>

    // objectNormal is in local space, skinned.
    // transformed is in local space, skinned.
    vec3 worldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vWorldPos = worldPos.xyz;

    if (edge) {
        // Simple and robust extrusion for anime outlines.
        worldPos.xyz += worldNormal * edgeWidthRatio;
    }

    vWorldNormal = worldNormal;
    // Convention: uniform lightDirection is expected to be direction of light rays
    // (from light to surface). We negate it to get surface-to-light for N·L.
    vLightDirection = normalize(-lightDirection);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// -------------------------------------------------------------------
// Fragment Shader
// Two-pass: edge pass = solid edgeColor, fill pass = toon-shaded texture
// -------------------------------------------------------------------
export const toonFragmentShader = /* glsl */ `
uniform sampler2D tStep;      // 1D toon ramp texture
uniform sampler2D tDiffuse;   // colour texture
uniform sampler2D tNormalMap; // normal map
uniform bool  edge;
uniform vec4  edgeColor;
uniform float lightIntensity;
uniform float alphaTest;

uniform vec3  lightColor;
uniform vec3  ambientColor;

uniform int   toonBands;      // 2..4
uniform float toonSoftness1;  // 0..0.25
uniform float toonSoftness2;  // 0..0.25
uniform float toonSoftness3;  // 0..0.25
// Back-compat (older JS may still set a single softness).
uniform float toonSoftness;   // 0..0.25
uniform float toonT1;         // boundary 1
uniform float toonT2;         // boundary 2
uniform float toonT3;         // boundary 3
uniform float toonShadow;     // intensity of shadow band
uniform float toonMid;        // intensity of mid band
uniform float toonLight;      // intensity of light band
uniform float toonHighlight;  // intensity of highlight band

varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vLightDirection;
varying vec3 vWorldPos;

vec3 decodeNormal( vec3 n ) {
    return normalize( n * 2.0 - 1.0 );
}

vec3 perturbNormal( vec3 worldPos, vec3 worldNormal, vec2 uv ) {
    vec3 N = normalize( worldNormal );

    // If derivatives aren't available, just use the interpolated normal.
    #if !defined( GL_OES_standard_derivatives )
        return N;
    #endif

    vec3 mapN = decodeNormal( texture2D( tNormalMap, uv ).xyz );

    // Build TBN from derivatives (works without precomputed tangents)
    vec3 dp1 = dFdx( worldPos );
    vec3 dp2 = dFdy( worldPos );
    vec2 duv1 = dFdx( uv );
    vec2 duv2 = dFdy( uv );

    vec3 T = dp1 * duv2.y - dp2 * duv1.y;
    vec3 B = -dp1 * duv2.x + dp2 * duv1.x;

    float tLen = length( T );
    float bLen = length( B );
    if ( tLen < 1e-5 || bLen < 1e-5 ) {
        return N;
    }

    T /= tLen;
    B /= bLen;

    mat3 TBN = mat3( T, B, N );
    return normalize( TBN * mapN );
}

float toonRamp( float ndl ) {
    float s1 = max( 1e-6, toonSoftness1 );
    float s2 = max( 1e-6, toonSoftness2 );
    float s3 = max( 1e-6, toonSoftness3 );

    // Optional legacy fallback (only if a caller deliberately passes negative softness).
    float legacy = max( 1e-6, toonSoftness );
    if ( toonSoftness1 < 0.0 ) s1 = legacy;
    if ( toonSoftness2 < 0.0 ) s2 = legacy;
    if ( toonSoftness3 < 0.0 ) s3 = legacy;

    float v;

    if ( toonBands <= 2 ) {
        // 2 bands: shadow -> light
        v = mix( toonShadow, toonLight, smoothstep( toonT1 - s1, toonT1 + s1, ndl ) );
    } else if ( toonBands == 3 ) {
        // 3 bands: shadow -> mid -> light
        float a = smoothstep( toonT1 - s1, toonT1 + s1, ndl );
        float b = smoothstep( toonT2 - s2, toonT2 + s2, ndl );
        v = mix( toonShadow, toonMid, a );
        v = mix( v, toonLight, b );
    } else {
        // 4 bands: shadow -> mid -> light -> highlight
        float a = smoothstep( toonT1 - s1, toonT1 + s1, ndl );
        float b = smoothstep( toonT2 - s2, toonT2 + s2, ndl );
        float c = smoothstep( toonT3 - s3, toonT3 + s3, ndl );
        v = mix( toonShadow, toonMid, a );
        v = mix( v, toonLight, b );
        v = mix( v, toonHighlight, c );
    }

    return v;
}

void main(void) {
    vec4 baseColor = texture2D(tDiffuse, vUv);
    if (baseColor.a < alphaTest) discard;

    if (edge) {
        gl_FragColor = edgeColor;
    } else {
        vec3 l = normalize( vLightDirection );
        vec3 n = perturbNormal( vWorldPos, vWorldNormal, vUv );

        float ndl = clamp( dot( n, l ), 0.0, 1.0 );
        float band = toonRamp( ndl );

        vec3 litCol = lightColor * lightIntensity;
        vec3 shaded = baseColor.rgb * ( ambientColor + litCol * band );
        gl_FragColor = vec4( max( shaded, vec3( 0.0 ) ), baseColor.a );
    }
}
`;

// -------------------------------------------------------------------
// Generates a simple 2-band toon ramp as a DataTexture
// Dark band below 0.5, light band at or above 0.5
// -------------------------------------------------------------------
export function createStepTexture() {
    const width = 256;
    const height = 1;
    const data = new Uint8Array(width * height * 4);

    for (let i = 0; i < width; i++) {
        // Two toon bands: shadow and lit
        const value = i / width < 0.5 ? 80 : 255;
        data[i * 4 + 0] = value; // R
        data[i * 4 + 1] = value; // G
        data[i * 4 + 2] = value; // B
        data[i * 4 + 3] = 255;   // A
    }

    const tex = new THREE.DataTexture(data, width, height);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
}

// -------------------------------------------------------------------
// Factory – creates one ShaderMaterial per mesh using its own textures
// Call with: createToonMaterial(stepTex, colorTex, normalTex, options)
// -------------------------------------------------------------------
export function createToonMaterial(stepTexture, colorTexture, normalMapTexture, {
    edgeColor = new THREE.Vector4(0, 0, 0, 1),
    edgeWidthRatio = 0.004,
    lightDirection = new THREE.Vector3(0, -1, -1),
    lightColor = new THREE.Color(1, 1, 1),
    ambientColor = new THREE.Color(0.25, 0.25, 0.25),
    toonBands = 2,
    toonSoftness1 = 0.02,
    toonSoftness2 = 0.02,
    toonSoftness3 = 0.02,
    toonSoftness = 0.02,
    toonT1 = 0.5,
    toonT2 = 0.75,
    toonT3 = 0.9,
    toonShadow = 0.3,
    toonMid = 0.65,
    toonLight = 1.0,
    toonHighlight = 1.15,
    transparent = false,
    alphaTest = 0,
    skinning = false,
} = {}) {
    return new THREE.ShaderMaterial({
        uniforms: {
            edge: { value: false },
            lightDirection: { value: lightDirection },
            lightIntensity: { value: 1.0 },
            tStep: { value: stepTexture },
            tDiffuse: { value: colorTexture },
            tNormalMap: { value: normalMapTexture },
            edgeColor: { value: edgeColor },
            edgeWidthRatio: { value: edgeWidthRatio },
            alphaTest: { value: alphaTest },
            lightColor: { value: lightColor },
            ambientColor: { value: ambientColor },
            toonBands: { value: toonBands },
            toonSoftness1: { value: toonSoftness1 },
            toonSoftness2: { value: toonSoftness2 },
            toonSoftness3: { value: toonSoftness3 },
            toonSoftness: { value: toonSoftness },
            toonT1: { value: toonT1 },
            toonT2: { value: toonT2 },
            toonT3: { value: toonT3 },
            toonShadow: { value: toonShadow },
            toonMid: { value: toonMid },
            toonLight: { value: toonLight },
            toonHighlight: { value: toonHighlight },
            // cameraPosition : { value: new THREE.Vector3() }, // Provided automatically by Three.js
        },
        vertexShader: toonVertexShader,
        fragmentShader: toonFragmentShader,
        transparent,
        alphaTest,
        skinning,
        extensions: {
            derivatives: true
        }
    });
}
