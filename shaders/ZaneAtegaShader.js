import * as THREE from 'three';

// -------------------------------------------------------------------
// ZaneAtega Anime Shader – Vertex Shader
// Supports skinning, morph targets, and outline extrusion.
// -------------------------------------------------------------------
export const zaneAtegaVertexShader = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <morphtarget_pars_vertex>

uniform int morphTextureStride;

vec3 getMorph2(const in int vertexIndex, const in int morphTargetIndex, const in int offset) {
    int texelIndex = vertexIndex * int(morphTextureStride) + offset;
    int width = int(morphTargetsTextureSize.x);
    int y = texelIndex / width;
    int x = texelIndex - y * width;
    ivec3 morphUV = ivec3(x, y, morphTargetIndex);
    return texelFetch(morphTargetsTexture, morphUV, 0).xyz;
}

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vNormalTransformed;
varying vec3 vViewDir;

uniform bool isOutline;
uniform float outlineThickness;

void main() {
    #include <beginnormal_vertex>

    for (int i = 0; i < MORPHTARGETS_COUNT; i++) {
        if (morphTargetInfluences[i] > 0.0) objectNormal += getMorph2(gl_VertexID, i, 1) * morphTargetInfluences[i];
    }

    #include <defaultnormal_vertex>

    #include <begin_vertex>
    if(isOutline) transformed = vec3(position + normal * outlineThickness);

    for (int i = 0; i < MORPHTARGETS_COUNT; i++) {
        if (morphTargetInfluences[i] > 0.0) transformed += getMorph2(gl_VertexID, i, 0) * morphTargetInfluences[i];
    }

    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <skinning_vertex>

    #include <worldpos_vertex>

    vUv = uv;

    vec4 modelPosition = modelMatrix * vec4(transformed, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 clipPosition = projectionMatrix * viewPosition;

    vNormal = normalize(normalMatrix * objectNormal);
    vNormalTransformed = normalize(normalMatrix * transformedNormal);
    vViewDir = normalize(-viewPosition.xyz);

    gl_Position = clipPosition;
}
`;

// -------------------------------------------------------------------
// ZaneAtega Anime Shader – Fragment Shader
// Toon shading with face SDF, Blinn-Phong specular, rim light,
// shadow tinting, GT tonemapping, and outline burn.
// -------------------------------------------------------------------
export const zaneAtegaFragmentShader = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>

// VISUAL CONTROLS
uniform vec3 lightTint;
uniform vec3 rimTint;
uniform vec3 ambientTint;
uniform vec3 shadowTint;
uniform float tintStrength;

uniform float glossiness;
uniform float counterExposure;
uniform float saturation;
uniform float hairSaturation;

uniform float outlineBurnIntensity;
uniform float outlineLightInfluence;
uniform float outlineMaxBrightness;

// TEXTURES
uniform sampler2D base;
uniform sampler2D faceSDF;
uniform sampler2D eyeHighlight;
uniform sampler2D eyeBottomHighlight;
uniform sampler2D hairHM;

/* --- */

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vNormalTransformed;
varying vec3 vViewDir;

const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);

uniform bool isEye;
uniform bool isFace;
uniform bool isHair;
uniform bool isOutline;

vec3 adjustSat(vec3 color, float sat) { return mix(vec3(dot(color, LUM)), color, sat); }
float GTTonemap(float x);

void main() {
    vec3 diffuseColor = texture2D(base, vUv).rgb;

    if (isEye) {
        diffuseColor = mix(
            mix(diffuseColor, vec3(1.0), texture2D(eyeHighlight, vUv).r),
            vec3(1.0),
            texture2D(eyeBottomHighlight, vUv).r
        );
    }

    // Adjust Tints
    vec3 lightTint = adjustSat(lightTint, tintStrength);
    vec3 rimTint = adjustSat(rimTint, tintStrength);
    vec3 ambientTint = adjustSat(ambientTint, tintStrength);
    vec3 shadowTint = adjustSat(shadowTint, tintStrength);

    // Directional Light
    vec3 lightDir = directionalLights[0].direction;

    if (isFace) {
        vec3 faceShadow = texture2D(faceSDF, vUv).rgb;
        vec3 faceShadowFlip = texture2D(faceSDF, vec2(1.0 - vUv.x, vUv.y)).rgb;

        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), vNormal));
        float RdotL = dot(right.xy, lightDir.xy);
        float faceShadowR = mix(faceShadowFlip.b, faceShadow.b, RdotL * 0.5 + 0.5);

        vec3 forward = normalize(cross(vec3(1.0, 0.0, 0.0), vNormal));
        float FdotL = dot(forward.xy, lightDir.xy);
        float faceShadowF = mix(faceShadowR, 1.0, FdotL * 0.5 + 0.5);

        float ave = ((RdotL * 0.5 + 0.5) + (FdotL * 0.5 + 0.5)) / 2.0;
        lightDir = lightDir * mix(faceShadowR, faceShadowF, ave) * 1.61803;
    }

    float NdotL = max(dot(vNormal, lightDir), 0.0);
    float lightIntensity = NdotL;

    vec3 directionalLight = directionalLights[0].color * lightIntensity * lightTint;

    // Specular
    vec3 halfVector = normalize(lightDir + vViewDir);
    float NdotH = max(dot(vNormal, halfVector), 0.0);

    float specularIntensity = pow(NdotH, 1000.0 / glossiness);
    specularIntensity *= lightIntensity;

    // Fresnel
    vec3 F0 = vec3(0.04);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - dot(halfVector, vViewDir), 5.0);

    vec3 specular = specularIntensity * directionalLights[0].color * F;

    // Rim Light
    float rimDot = 1.0 - max(dot(vViewDir, vNormalTransformed), 0.0);
    float rimThreshold = 0.2;
    float rimIntensity = rimDot * pow(NdotL, rimThreshold);

    float rimAmount = 0.6;
    rimIntensity = smoothstep(rimAmount - 0.01, rimAmount + 0.01, rimIntensity);

    vec3 rim = rimIntensity * directionalLights[0].color * rimTint;

    // Final Lighting
    vec3 finalLighting = directionalLight + specular + rim;

    if (isOutline) {
        vec3 colorBurn = 1.0 - (1.0 - diffuseColor) / max(diffuseColor, 0.001);
        colorBurn = mix(vec3(1.0), colorBurn, outlineBurnIntensity);

        vec3 outlineColor = colorBurn * mix(vec3(1.0), finalLighting, outlineLightInfluence);

        outlineColor = min(vec3(outlineMaxBrightness), outlineColor);

        gl_FragColor = vec4(outlineColor, 1.0);
        return;
    }

    vec3 litColor = diffuseColor * (ambientLightColor * ambientTint + finalLighting);
    vec3 withShadowTint = litColor * mix(vec3(1.0), shadowTint, 1.0 - lightIntensity);

    // Color Grading
    vec3 correctExposure = withShadowTint * counterExposure;

    if (isHair) correctExposure += directionalLight * texture2D(hairHM, vUv).r * 0.075;

    vec3 GT = vec3(GTTonemap(correctExposure.r), GTTonemap(correctExposure.g), GTTonemap(correctExposure.b));
    vec3 adjustedSat = adjustSat(GT, saturation);
    vec3 gamma = pow(adjustedSat, vec3(1.0 / 2.0875));

    vec3 finalColor = gamma;

    if(isHair) finalColor = adjustSat(gamma, hairSaturation);

    gl_FragColor = vec4(finalColor, 1.0);
}

// GT Tonemap
const float P = 1.0;
const float m = 0.22;
const float l = 0.40;
const float a = 1.0;
const float c = 1.33;
const float b = 0.0;

float GTTonemap(float x) {
    float l0 = (P - m) * l / a;
    float S1 = m + a * l0;
    float C2 = a * P / (P - S1);
    float S0 = m + l0;
    float S_x = P - (P - S1) * exp(-C2 * (x - S0) / P);
    float L_x = m + a * (x - m);
    float w2_x = (x < m + l) ? 0.0 : 1.0;
    float w0_x = 1.0 - smoothstep(0.0, m, x);
    float w1_x = 1.0 - w0_x - w2_x;
    float T_x = m * pow(x / m, c) + b;
    return T_x * w0_x + L_x * w1_x + S_x * w2_x;
}
`;


// -------------------------------------------------------------------
// Factory – creates one ShaderMaterial per mesh
// options: { isEye, isFace, isHair, skinning, transparent, alphaTest }
// -------------------------------------------------------------------
export function createZaneAtegaMaterial(colorTex, options = {}) {
    const {
        isEye = false,
        isFace = false,
        isHair = false,
        skinning = false,
        transparent = false,
        alphaTest = 0,
        // Visual defaults
        lightTint = new THREE.Color(1, 1, 1),
        rimTint = new THREE.Color(1, 1, 1),
        ambientTint = new THREE.Color(1, 1, 1),
        shadowTint = new THREE.Color(1, 1, 1),
        tintStrength = 1.0,
        glossiness = 10.0,
        counterExposure = 1.0,
        saturation = 1.0,
        hairSaturation = 1.0,
        outlineThickness = 0.003,
        outlineBurnIntensity = 1.0,
        outlineLightInfluence = 0.5,
        outlineMaxBrightness = 1.0,
    } = options;

    // 1x1 white fallback for optional textures (faceSDF needs white to not be fully in shadow)
    const whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    whiteTex.needsUpdate = true;

    // 1x1 black fallback
    const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blackTex.needsUpdate = true;

    const mat = new THREE.ShaderMaterial({
        vertexShader: zaneAtegaVertexShader,
        fragmentShader: zaneAtegaFragmentShader,
        uniforms: THREE.UniformsUtils.merge([
            THREE.UniformsLib.lights,
            {
                // Textures
                base: { value: colorTex },
                faceSDF: { value: whiteTex },
                eyeHighlight: { value: blackTex },
                eyeBottomHighlight: { value: blackTex },
                hairHM: { value: blackTex },
                // Booleans
                isEye: { value: isEye },
                isFace: { value: isFace },
                isHair: { value: isHair },
                isOutline: { value: false },
                // Visual controls
                lightTint: { value: lightTint.clone() },
                rimTint: { value: rimTint.clone() },
                ambientTint: { value: ambientTint.clone() },
                shadowTint: { value: shadowTint.clone() },
                tintStrength: { value: tintStrength },
                glossiness: { value: glossiness },
                counterExposure: { value: counterExposure },
                saturation: { value: saturation },
                hairSaturation: { value: hairSaturation },
                outlineThickness: { value: outlineThickness },
                outlineBurnIntensity: { value: outlineBurnIntensity },
                outlineLightInfluence: { value: outlineLightInfluence },
                outlineMaxBrightness: { value: outlineMaxBrightness },
                // Morph target stride (set by Three.js or manually)
                morphTextureStride: { value: 1 },
            }
        ]),
        lights: true,
        skinning: skinning,
        morphTargets: true,
        morphNormals: true,
        transparent: transparent,
        side: transparent ? THREE.DoubleSide : THREE.FrontSide,
    });

    if (alphaTest > 0) {
        mat.alphaTest = alphaTest;
    }

    return mat;
}
