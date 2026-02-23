import * as THREE from 'three';

/**
 * Simple screen-space water ripple shader.
 * Mimics jquery.ripples by distorting the UVs based on wave packets.
 */
export const WaterRippleShader = {

	uniforms: {

		'tDiffuse': { value: null },
		'uTime': { value: 0 },
		'uResolution': { value: new THREE.Vector2() },
		'uRipples': { value: Array.from({ length: 20 }, () => new THREE.Vector4(-1, -1, 0, 0)) },
		'uRippleCount': { value: 0 }

	},

	vertexShader: /* glsl */`

		varying vec2 vUv;

		void main() {

			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

	fragmentShader: /* glsl */`

		uniform sampler2D tDiffuse;
		uniform float uTime;
		uniform vec2 uResolution;

		// Maximum number of ripples supported
		#define MAX_RIPPLES 20

		// Ripples: x, y (center uv), z (startTime), w (amplitude)
		uniform vec4 uRipples[MAX_RIPPLES];
		uniform int uRippleCount;

		varying vec2 vUv;

		void main() {

			vec2 uv = vUv;
			vec2 resolution = uResolution;
			float aspectRatio = resolution.x / resolution.y;

			vec2 totalOffset = vec2(0.0);

			for (int i = 0; i < MAX_RIPPLES; i++) {
				if (i >= uRippleCount) break;

				vec4 ripple = uRipples[i];
				vec2 center = ripple.xy;
				float startTime = ripple.z;
				float amplitude = ripple.w;
				
				float age = uTime - startTime; // Time elapsed since ripple start

				if (age > 0.0) {
					// Correct distance for aspect ratio to ensure circular ripples
					vec2 toPixel = uv - center;
					vec2 toPixelAspect = toPixel;
					toPixelAspect.x *= aspectRatio;
					
					float dist = length(toPixelAspect);

					// Ripple parameters
					// speed: how fast the wave spreads
					// frequency: how tight the waves are
					// decay: how fast the amplitude drops over time
					float speed = 0.5;
					float frequency = 10.0;
					float decay = 2.0;
					
					// Wave function
					// sin(distance * freq - time * speed)
					// We modify it to only show the wavefront moving out
					
					float phase = dist * frequency - age * speed * frequency;
					// Add damping to phase to slow down wave slightly over time? No, constant speed is fine.

                    // Wave packet logic:
                    // The wave front is at dist = age * speed
                    float waveFront = age * speed;
                    
                    // Simple ring
                    // A sin wave that decays with distance from the wavefront center
                    float dr = dist - waveFront;
                    
                    // Gaussian profile for the wave packet width
                    float packetWidth = 0.03 + age * 0.05; 
                    float envelope = exp(-pow(dr / packetWidth, 2.0));
                    
                    // Oscillations inside the packet
                    float wave = sin(dr * 50.0);
                    
                    // Fade out the whole ripple over time and distance
                    float fade = exp(-age * decay);
                    fade *= 1.0 - smoothstep(0.0, 1.5, dist); // Fade at edges of screen/max radius
                    
                    // Calculate displacement
                    float strength = wave * envelope * fade * amplitude;
                    
                    // Direction of displacement
                    vec2 dir = normalize(toPixelAspect);
                    
                    totalOffset += dir * strength;
				}
			}

			// Apply distortion
			vec4 color = texture2D( tDiffuse, uv + totalOffset );
			
			// Optional: add some specular highlight based on distortion
            // Use the offset as a pseudo-normal for lighting
			// float light = length(totalOffset);
			// color.rgb += vec3(light) * 2.0;

			gl_FragColor = color;

		}`

};

