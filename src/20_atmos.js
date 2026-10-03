/* =====================================================================================
   ATMOSPHERE — sky, water, haze and light shafts, scaled by the graphics quality setting.
     low     the original look, untouched (original sky + water shaders, plain linear fog, no extra pass)
     medium  scattering sky with a light cloud layer, wave-normal water reflecting that sky, height haze + sun glow
     high    + fuller clouds lit from the sun, water sun glitter + ripple detail, light shafts (quarter res, 32 taps)
     ultra   + cloud self-shadow, twinkling stars, wave-crest foam, light shafts (half res, 64 taps)
   The sky and water keep their material objects (the scan world shares game.waterMat); a tier change swaps their
   shaders and recompiles. Haze is added to three's fog chunk for every fogged material: its parameters live in
   plain {x,y,z} uniform values, which three's uniform cloning passes by reference, so one object drives every
   material (built-in and custom). With those values at zero the chunk is exactly the original linear fog.
   Light shafts reuse the comic filter's approach (scene into a colour + depth target, then a full-screen pass) and
   stand down while the comic filter is on or the sun is out of view.
   ===================================================================================== */
'use strict';

TL.Atmos = {
  tier: 0,
  // shared haze uniforms (plain objects: never cloned, so every fogged material sees the same values)
  hz: { sun: { x: 0, y: 1, z: 0 }, col: { x: 0, y: 0, z: 0 }, p: { x: 0, y: 0.012, z: 0, w: 0 } },
  TIER: { low: 0, medium: 1, high: 2, ultra: 3 },
  CLOUD_OCT: [0, 3, 5, 6],
};

/* ------------------------------------------------------------------ haze in the fog chunk (all fogged materials) */
{
  const A = TL.Atmos, C = THREE.ShaderChunk;
  const extra = { tlSunDir: { value: A.hz.sun }, tlSunCol: { value: A.hz.col }, tlHaze: { value: A.hz.p } };
  Object.assign(THREE.UniformsLib.fog, extra);
  for (const k in THREE.ShaderLib) { const u = THREE.ShaderLib[k].uniforms; if (u && u.fogColor) Object.assign(u, extra); }
  C.fog_pars_vertex = C.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vTlFogRel;');
  // camera-relative world offset: transpose(mat3(view)) * viewPos (the view rotation is orthonormal)
  C.fog_vertex = C.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvTlFogRel = mvPosition.xyz * mat3( viewMatrix );');
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying vec3 vTlFogRel;\n\tuniform vec3 tlSunDir;\n\tuniform vec3 tlSunCol;\n\tuniform vec4 tlHaze;');
  // exponential height haze integrated along the view ray + forward-scattered sun glow, combined with the linear fog
  // (which still hides the streaming edge). tlHaze: x density at base height, y height falloff, z base height, w glow.
  C.fog_fragment = C.fog_fragment.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', `vec3 tlFogC = fogColor;
	if ( tlHaze.x > 0.0 ) {
		float tlD = length( vTlFogRel ); vec3 tlRd = vTlFogRel / max( tlD, 1e-3 );
		float tlK = tlHaze.y * vTlFogRel.y;
		float tlOd = tlHaze.x * exp( - tlHaze.y * ( cameraPosition.y - tlHaze.z ) ) * ( abs( tlK ) > 1e-4 ? ( 1.0 - exp( - tlK ) ) / tlK : 1.0 ) * tlD;
		float tlHz = 1.0 - exp( - min( tlOd, 30.0 ) );
		tlFogC = fogColor + tlSunCol * ( pow( max( dot( tlRd, tlSunDir ), 0.0 ), 6.0 ) * tlHaze.w );
		fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - tlHz );
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, tlFogC, fogFactor );`);
}

/* ------------------------------------------------------------------ shared GLSL: noise, clouds, sky colour */
TL.Atmos.SKY_GLSL = `
uniform vec3 uSunDir, uMoonDir, uHor, uZen, uSunCol; uniform float uNight, uStars, uTime, uRain, uCloud, uGolden;
float tlH12( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float tlN2( vec2 p ) { vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( tlH12( i ), tlH12( i + vec2( 1.0, 0.0 ) ), u.x ), mix( tlH12( i + vec2( 0.0, 1.0 ) ), tlH12( i + vec2( 1.0, 1.0 ) ), u.x ), u.y ); }
float tlFbm( vec2 p, int oct ) { float a = 0.5, s = 0.0; mat2 m = mat2( 1.6, 1.2, -1.2, 1.6 );
  for ( int i = 0; i < 8; i ++ ) { if ( i >= oct ) break; s += a * tlN2( p ); p = m * p; a *= 0.5; } return s; }
float tlStarH( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
/* cloud layer on a flat ceiling: rgb colour, a coverage */
vec4 tlClouds( vec3 d, int oct ) {
  if ( d.y <= 0.0 || uCloud <= 0.0 ) return vec4( 0.0 );
  vec2 p = d.xz / ( d.y + 0.12 ) * 1.4 + vec2( uTime * 0.010, uTime * 0.0035 );
  float cov = mix( 0.40, 0.92, uRain ) * uCloud, lo = 1.0 - cov;
  float n = tlFbm( p, oct );
  float dens = smoothstep( lo, lo + 0.32, n );
  if ( dens <= 0.001 ) return vec4( 0.0 );
  float shade = 0.82 + 0.18 * smoothstep( lo + 0.35, lo, n );          // thin edges brighter
#if TL_Q >= 2
  vec2 ls = normalize( uSunDir.xz + 1e-4 ) * 0.09;                     // density toward the sun: lit vs self-shadowed side
  float occ = smoothstep( lo, lo + 0.45, tlFbm( p + ls, oct - 2 ) );
#if TL_Q >= 3
  occ = 0.6 * occ + 0.4 * smoothstep( lo, lo + 0.45, tlFbm( p + ls * 2.5, oct - 3 ) );
#endif
  shade *= 1.0 - 0.55 * occ;
#endif
  float day = 1.0 - uNight;
  vec3 lit = mix( vec3( 1.0 ), uSunCol, 0.5 ) * ( 0.25 + 0.75 * day ) + uHor * 0.25;
  vec3 dark = mix( uZen, uHor, 0.6 ) * 0.62;
  vec3 col = mix( dark, lit, shade );
  float sd = max( dot( d, uSunDir ), 0.0 );
  col += uSunCol * pow( sd, 9.0 ) * ( 1.0 - dens ) * 1.6 * day;        // silver lining near the sun
  col = mix( col, vec3( dot( col, vec3( 0.333 ) ) ) * 0.72, uRain * 0.65 );
  col *= mix( 1.0, 0.18, uNight );
  return vec4( col, dens * smoothstep( 0.0, 0.2, d.y ) * 0.96 );
}
vec3 tlSky( vec3 d, int cloudOct ) {
  float up = max( d.y, 0.0 ), t = clamp( d.y * 1.6, 0.0, 1.0 );
  vec3 c = mix( uHor, uZen, pow( t, 0.55 ) );
  c = mix( c, uHor * 1.05, exp( - up * 14.0 ) * 0.55 );                 // horizon haze band
  float sd = max( dot( d, uSunDir ), 0.0 ), day = 1.0 - uNight;
  float side = pow( max( dot( normalize( d.xz + 1e-4 ), normalize( uSunDir.xz + 1e-4 ) ), 0.0 ), 3.0 );
  c = mix( c, c * vec3( 1.28, 0.92, 0.70 ), uGolden * side * exp( - up * 5.0 ) );   // warm low-sun side
  c += uSunCol * ( pow( sd, 10.0 ) * 0.16 + pow( sd, 90.0 ) * 0.45 ) * day;       // Mie glow
  c += uSunCol * smoothstep( 0.99965, 0.99985, sd ) * 14.0 * day * ( 1.0 - uRain * 0.85 );  // sun disc
  float md = max( dot( d, uMoonDir ), 0.0 ); c += vec3( 0.8, 0.85, 1.0 ) * ( smoothstep( 0.99955, 0.9998, md ) * 2.5 + pow( md, 60.0 ) * 0.08 ) * uNight;
  vec3 g = floor( d * 400.0 ); float s = step( 0.9975, tlStarH( g ) ) * uNight * t * uStars * ( 1.0 - uRain );
#if TL_Q >= 3
  s *= 0.55 + 0.45 * sin( uTime * 2.7 + tlStarH( g + 7.0 ) * 60.0 );
#endif
  c += vec3( s );
  c = mix( c, uHor * 1.25 + vec3( 0.022, 0.016, 0.010 ), exp( - up * 9.0 ) * uNight * 0.8 );   // city glow on the night horizon
  if ( cloudOct > 0 ) { vec4 cl = tlClouds( d, cloudOct ); c = mix( c, cl.rgb, cl.a ); }
  return c;
}`;

TL.Atmos.SKY_FRAG = `varying vec3 vD;
${TL.Atmos.SKY_GLSL}
void main() {
  vec3 d = normalize( vD ), c;
  c = tlSky( d, CLOUD_OCT );
  // Blend below the horizon into water-edge fog, preserving glow continuously at eye level.
  c = mix( c, uHor, smoothstep( 0.0, 0.15, - d.y ) );
  gl_FragColor = linearToOutputTexel( vec4( c, 1.0 ) );
}`;

/* water: analytic wave normals (directional wave sum, plus noise ripples on high+), Schlick fresnel to the same sky
   (clouds included from high), sun specular with glitter, scattering toward the light, crest foam on ultra */
TL.Atmos.WATER_FRAG = `varying vec3 vW;
${TL.Atmos.SKY_GLSL}
#include <fog_pars_fragment>
void main() {
  vec2 p = vW.xz; float t = uTime;
  vec3 V = normalize( cameraPosition - vW ); float dist = length( cameraPosition - vW );
  float amp = 1.0 / ( 1.0 + dist * 0.008 );
  vec2 g = vec2( 0.0 ); float a = 0.17, k = 0.32, w = 0.85, h = 0.0;
  for ( int i = 0; i < 12; i ++ ) {
    if ( i >= WAVES ) break;
    float an = float( i ) * 2.39996 + 0.7; vec2 dir = vec2( cos( an ), sin( an ) );
    float ph = dot( dir, p ) * k + t * w;
    g += dir * ( a * k * cos( ph ) ); h += a * sin( ph );
    a *= 0.74; k *= 1.33; w *= 1.13;
  }
#if TL_Q >= 2
  vec2 q = p * 0.85 + vec2( t * 0.33, t * 0.21 ); float e = 0.07;
  float n0 = tlFbm( q, 3 ), nx = tlFbm( q + vec2( e, 0.0 ), 3 ), nz = tlFbm( q + vec2( 0.0, e ), 3 );
  g += vec2( n0 - nx, n0 - nz ) / e * 0.035 * ( 1.0 + uRain * 1.8 ) / ( 1.0 + dist * 0.02 );
#endif
  g *= amp * ( 1.0 + uRain * 0.6 );
  vec3 N = normalize( vec3( - g.x, 1.0, - g.y ) );
  float nv = max( dot( N, V ), 0.0 );
  float fres = 0.02 + 0.98 * pow( 1.0 - nv, 5.0 );
  vec3 R = reflect( - V, N ); R.y = max( R.y, 0.02 ); R = normalize( R );
  vec3 refl = tlSky( R, REFL_CLOUDS );
  float day = 1.0 - uNight;
  vec3 deep = mix( vec3( 0.014, 0.048, 0.062 ), vec3( 0.004, 0.009, 0.018 ), uNight );
  vec3 scat = vec3( 0.03, 0.12, 0.11 ) * day * ( 0.3 + 0.7 * max( dot( N, uSunDir ), 0.0 ) ) * ( 0.4 + 0.6 * pow( 1.0 - max( V.y, 0.0 ), 2.0 ) );
  vec3 c = mix( deep + scat, refl, fres );
  vec3 H = normalize( V + uSunDir ); float nh = max( dot( N, H ), 0.0 );
  float spec = pow( nh, 900.0 ) * 7.0 + pow( nh, 80.0 ) * 0.22;
#if TL_Q >= 2
  float gl = step( 0.982, tlH12( floor( p * 5.0 + vec2( t * 1.7, - t * 1.3 ) ) ) ) * pow( nh, 30.0 ) * 5.0 / ( 1.0 + dist * 0.01 );
  spec += gl;
#endif
  c += uSunCol * spec * day * ( 1.0 - uRain * 0.75 );
  vec3 Hm = normalize( V + uMoonDir ); c += vec3( 0.6, 0.65, 0.8 ) * pow( max( dot( N, Hm ), 0.0 ), 600.0 ) * 2.5 * uNight;
#if TL_Q >= 3
  float foam = smoothstep( 0.32, 0.5, h ) * smoothstep( 0.5, 0.72, tlFbm( p * 0.3 + vec2( t * 0.06, t * 0.02 ), 4 ) ) * amp;
  c = mix( c, ( uHor * 0.45 + 0.55 ) * mix( 0.9, 0.12, uNight ), foam * ( 0.3 + 0.3 * uRain ) );
#endif
  gl_FragColor = vec4( c, 1.0 );
  #include <fog_fragment>
  gl_FragColor = linearToOutputTexel( gl_FragColor );
}`;

/* ------------------------------------------------------------------ apply a tier to the sky + water materials */
TL.Atmos.apply = function (game) {
  const A = TL.Atmos, env = game.env;
  const tier = A.TIER[game.quality] || 0;
  A.tier = tier;
  if (!env || !env.sky) return;
  const U = env.skyU;
  if (!U.uTime) Object.assign(U, { uTime: { value: 0 }, uRain: { value: 0 }, uCloud: { value: 1 }, uGolden: { value: 0 }, uSunCol: { value: new THREE.Color() } });
  const sm = env.sky.material;
  if (!A.origSky) A.origSky = { frag: sm.fragmentShader };
  if (tier === 0) { sm.fragmentShader = A.origSky.frag; sm.defines = {}; }
  else { sm.fragmentShader = A.SKY_FRAG; sm.defines = { TL_Q: tier, CLOUD_OCT: A.CLOUD_OCT[tier] }; }
  sm.needsUpdate = true;
  const wm = game.waterMat;
  if (wm) {
    if (!A.origWater) A.origWater = { frag: wm.fragmentShader };
    for (const k of ['uZen', 'uSunDir', 'uMoonDir', 'uStars', 'uCloud', 'uGolden', 'uSunCol']) wm.uniforms[k] = U[k];
    if (tier === 0) { wm.fragmentShader = A.origWater.frag; wm.defines = {}; }
    else { wm.fragmentShader = A.WATER_FRAG; wm.defines = { TL_Q: tier, WAVES: [0, 5, 8, 12][tier], REFL_CLOUDS: tier >= 2 ? 4 : 0 }; }
    wm.needsUpdate = true;
  }
  if (tier === 0) { A.hz.p.x = 0; A.hz.p.w = 0; A.hz.col.x = A.hz.col.y = A.hz.col.z = 0; }
  env.envT = 999;                                     // refresh the reflection probe with the new sky
};

/* per frame, after the environment update: sun colour, golden-hour factor, clouds, haze */
TL.Atmos.update = function (env, dt) {
  const A = TL.Atmos, U = env.skyU;
  if (!U.uTime) return;
  const sd = U.uSunDir.value, night = env.night || 0;
  U.uTime.value += dt; U.uRain.value = env.rain;
  U.uGolden.value = TL.smooth(0.45, 0.05, sd.y) * (1 - night);
  U.uSunCol.value.copy(env.sun.color).multiplyScalar(TL.clamp(env.sun.intensity / 2.2, 0, 1.3));
  if (A.tier === 0) return;
  const ld = night > 0.5 ? U.uMoonDir.value : sd;
  A.hz.sun.x = ld.x; A.hz.sun.y = ld.y; A.hz.sun.z = ld.z;
  const glow = (1 - night * 0.85) * (1 - env.rain * 0.6);
  const sc = U.uSunCol.value; A.hz.col.x = sc.r * glow; A.hz.col.y = sc.g * glow; A.hz.col.z = sc.b * glow;
  A.hz.p.x = (0.00085 + 0.0014 * env.rain) * (1 - night * 0.3);   // ~40% haze at 600 m on the ground, thinner with altitude
  A.hz.p.y = 0.011; A.hz.p.z = TL.C.WATER_Y; A.hz.p.w = 0.75;
};

/* ------------------------------------------------------------------ light shafts (high: 1/4 res 32 taps, ultra: 1/2 res 64 taps) */
TL.Shafts = {
  rt: null, rays: null, _sz: new THREE.Vector2(), _v: new THREE.Vector3(), _f: new THREE.Vector3(),
  init(r) {
    const gl2 = r.capabilities.isWebGL2;
    r.getDrawingBufferSize(this._sz);
    this.rt = new THREE.WebGLRenderTarget(this._sz.x, this._sz.y, { type: THREE.HalfFloatType, depthBuffer: true, samples: gl2 ? 4 : 0 });
    this.rt.depthTexture = new THREE.DepthTexture(this._sz.x, this._sz.y, THREE.UnsignedIntType);
    this.rays = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    // rays: march from the pixel toward the sun, collecting sky (depth == far) brightness with decay
    this.rayMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } },
      defines: { TAPS: 32 }, vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: false,
      fragmentShader: `varying vec2 vUv; uniform sampler2D tColor, tDepth; uniform vec2 uSun; uniform float uAspect;
        float h( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
        void main() {
          vec2 dlt = ( uSun - vUv ) / float( TAPS ) * 0.92;
          vec2 uv = vUv + dlt * h( gl_FragCoord.xy );         // jittered start hides banding
          float acc = 0.0, wgt = 1.0;
          for ( int i = 0; i < TAPS; i ++ ) {
            float sky = step( 0.99999, texture2D( tDepth, uv ).x );
            vec3 c = texture2D( tColor, uv ).rgb;
            vec2 o = ( uv - uSun ) * vec2( uAspect, 1.0 );
            acc += sky * smoothstep( 0.35, 1.2, dot( c, vec3( 0.333 ) ) ) * exp( - dot( o, o ) * 3.5 ) * wgt;
            wgt *= 0.975; uv += dlt;
          }
          gl_FragColor = vec4( vec3( acc / float( TAPS ) ), 1.0 );
        }`,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.rt.texture }, tRays: { value: this.rays.texture }, uCol: { value: new THREE.Color() }, uStr: { value: 0 } },
      vertexShader: vs, depthTest: false, depthWrite: false, toneMapped: false,
      fragmentShader: `varying vec2 vUv; uniform sampler2D tColor, tRays; uniform vec3 uCol; uniform float uStr;
        vec3 toSRGB( vec3 c ) { c = clamp( c, 0.0, 1.0 ); return mix( pow( c, vec3( 0.41666 ) ) * 1.055 - 0.055, c * 12.92, step( c, vec3( 0.0031308 ) ) ); }
        void main() {
          vec3 c = texture2D( tColor, vUv ).rgb + uCol * texture2D( tRays, vUv ).r * uStr;
          gl_FragColor = vec4( toSRGB( c ), 1.0 );
        }`,
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.quad = new THREE.Mesh(g, this.rayMat); this.quad.frustumCulled = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
  },
  /* how much the sun contributes right now: in front of the camera, daytime, not raining */
  strength(camera) {
    const env = TL.game && TL.game.env; if (!env || !env.skyU) return 0;
    const sd = env.skyU.uSunDir.value;
    camera.getWorldDirection(this._f);
    return TL.smooth(0.2, 0.55, this._f.dot(sd)) * (1 - (env.night || 0)) * (1 - env.rain * 0.85) * TL.smooth(-0.02, 0.1, sd.y);
  },
  render(r, scene, camera) {
    const tier = TL.Atmos.tier, k = tier >= 2 ? this.strength(camera) : 0;
    if (k < 0.01) { r.render(scene, camera); return; }
    if (!this.rt) this.init(r);
    r.getDrawingBufferSize(this._sz);
    if (this.rt.width !== this._sz.x || this.rt.height !== this._sz.y) this.rt.setSize(this._sz.x, this._sz.y);
    const div = tier >= 3 ? 2 : 4, rw = Math.max(1, Math.floor(this._sz.x / div)), rh = Math.max(1, Math.floor(this._sz.y / div));
    if (this.rays.width !== rw || this.rays.height !== rh) this.rays.setSize(rw, rh);
    const taps = tier >= 3 ? 64 : 32;
    if (this.rayMat.defines.TAPS !== taps) { this.rayMat.defines.TAPS = taps; this.rayMat.needsUpdate = true; }
    const env = TL.game.env, sd = env.skyU.uSunDir.value;
    this._v.copy(camera.position).addScaledVector(sd, 1000).project(camera);
    this.rayMat.uniforms.uSun.value.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);
    this.rayMat.uniforms.uAspect.value = this._sz.x / this._sz.y;
    this.compMat.uniforms.uCol.value.copy(env.skyU.uSunCol.value);
    this.compMat.uniforms.uStr.value = k * (tier >= 3 ? 2.4 : 1.9) * (1 + 0.4 * env.skyU.uGolden.value);   // stronger in golden hour
    TL.ComicLin.value = 1;                               // raw additive shaders linearise inside a target (as in the comic pass)
    r.setRenderTarget(this.rt); r.render(scene, camera);
    TL.ComicLin.value = 0;
    this.quad.material = this.rayMat; r.setRenderTarget(this.rays); r.render(this.scene, this.cam);
    this.quad.material = this.compMat; r.setRenderTarget(null); r.render(this.scene, this.cam);
  },
};

/* ------------------------------------------------------------------ hooks */
{
  const applyQuality = TL.Game.prototype.applyQuality;
  TL.Game.prototype.applyQuality = function (q) { applyQuality.call(this, q); TL.Atmos.apply(this); };
  const envUpdate = TL.Environment.prototype.update;
  TL.Environment.prototype.update = function (dt, focus) { envUpdate.call(this, dt, focus); TL.Atmos.update(this, dt); };
  const comicRender = TL.Comic.render;
  TL.Comic.render = function (r, scene, camera) {
    if ((this.style && this.level) || TL.Atmos.tier < 2) { comicRender.call(this, r, scene, camera); return; }
    TL.ComicLin.value = 0;
    TL.Shafts.render(r, scene, camera);
  };
}
