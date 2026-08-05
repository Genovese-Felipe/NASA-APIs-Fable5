/* ── Cosmoscope · engine.js ─────────────────────────────────────────
   WebGL2 ray tracer. Every pixel casts a real ray: analytic
   ray–sphere and ray–plane intersections, secondary shadow rays with
   penumbra (real eclipses), procedural planet surfaces, Saturn's
   rings, HDR bloom post-pipeline, and tiled offline rendering for
   4K/8K still export.                                               */

const MAX_BODIES = 12;

const VERT_FS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/* Scene fragment shader is assembled with quality #defines. */
function sceneShaderSource(opt) {
  return `#version 300 es
precision highp float;
precision highp int;

#define OCTAVES ${opt.octaves}
#define SOFT_SHADOWS ${opt.softShadows ? 1 : 0}
#define BELT ${opt.belt ? 1 : 0}

uniform vec2 uResolution;
uniform vec4 uSubRect;        /* x0, y0, w, h of virtual full frame (tiling) */
uniform vec2 uFullRes;        /* full virtual frame resolution */
uniform vec3 uCamPos;
uniform vec3 uCamRight, uCamUp, uCamFwd;
uniform float uFovTan;        /* tan(fovY/2) */
uniform float uTime;
uniform float uActivity;      /* solar activity 0..1 (DONKI-driven) */
uniform mat4 uVP;             /* for gl_FragDepth, matches line pass */
uniform int uNumBodies;
uniform vec4 uBodyPosR[${MAX_BODIES}];   /* xyz, radius */
uniform vec4 uBodyAxis[${MAX_BODIES}];   /* axis xyz, spin */
uniform vec4 uBodyMisc[${MAX_BODIES}];   /* shaderId, ringInner, ringOuter, 0 */
uniform float uBeltInner, uBeltOuter;    /* scene units; 0 = off */

in vec2 vUV;
layout(location=0) out vec4 fragColor;

/* ── hash & noise ── */
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0));
  float n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1));
  float n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1));
  float n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    v += a * vnoise(p);
    p = p * 2.13 + vec3(17.7);
    a *= 0.5;
  }
  return v;
}
float ridged(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    v += a * (1.0 - abs(2.0 * vnoise(p) - 1.0));
    p = p * 2.21 + vec3(9.2);
    a *= 0.5;
  }
  return v;
}

/* ── intersections ── */
float iSphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) return -1.0;
  h = sqrt(h);
  float t = -b - h;
  if (t > 0.0) return t;
  t = -b + h;
  return t > 0.0 ? t : -1.0;
}

/* ── shadowing: fraction of the solar disc visible from p ── */
float sunVisibility(vec3 p, int selfId) {
  vec3 sunC = uBodyPosR[0].xyz;
  float sunR = uBodyPosR[0].w;
  vec3 toSun = sunC - p;
  float dSun = length(toSun);
  vec3 L = toSun / dSun;
  float aSun = asin(clamp(sunR / dSun, 0.0, 1.0));
  float vis = 1.0;
  for (int i = 1; i < ${MAX_BODIES}; i++) {
    if (i >= uNumBodies) break;
    if (i == selfId) continue;
    vec3 oc = uBodyPosR[i].xyz - p;
    float dOcc = length(oc);
    if (dOcc >= dSun) continue;
    float aOcc = asin(clamp(uBodyPosR[i].w / dOcc, 0.0, 1.0));
    float sep = acos(clamp(dot(oc / dOcc, L), -1.0, 1.0));
#if SOFT_SHADOWS
    float t = clamp((sep - (aOcc - aSun)) / max(2.0 * aSun, 1e-5), 0.0, 1.0);
    vis *= smoothstep(0.0, 1.0, t);
#else
    vis *= sep < aOcc ? 0.0 : 1.0;
#endif
  }
  return vis;
}

/* Saturn ring shadow on bodies: attenuate sun along L through the ring annulus */
float ringOcclusion(vec3 p, int saturnIdx) {
  float rin = uBodyMisc[saturnIdx].y, rout = uBodyMisc[saturnIdx].z;
  if (rout <= 0.0) return 1.0;
  vec3 c = uBodyPosR[saturnIdx].xyz;
  vec3 ax = uBodyAxis[saturnIdx].xyz;
  vec3 L = normalize(uBodyPosR[0].xyz - p);
  float denom = dot(L, ax);
  if (abs(denom) < 1e-5) return 1.0;
  float t = dot(c - p, ax) / denom;
  if (t <= 0.0) return 1.0;
  vec3 hp = p + L * t;
  float r = length(hp - c);
  if (r < rin || r > rout) return 1.0;
  float q = (r - rin) / (rout - rin);
  float dens = 0.75 * (0.55 + 0.45 * vnoise(vec3(q * 60.0, 0.0, 0.0)));
  dens *= smoothstep(0.0, 0.03, q) * smoothstep(1.0, 0.9, q);
  return 1.0 - dens * 0.85;
}

/* ── local frame for surface texturing ── */
void bodyLocal(int i, vec3 p, out vec3 nLocal, out float lat, out float lon) {
  vec3 a = uBodyAxis[i].xyz;
  float spin = uBodyAxis[i].w;
  vec3 t0 = abs(a.y) < 0.99 ? normalize(cross(vec3(0,1,0), a)) : vec3(1,0,0);
  vec3 b0 = cross(a, t0);
  vec3 q = normalize(p - uBodyPosR[i].xyz);
  vec3 loc = vec3(dot(q, t0), dot(q, a), dot(q, b0));
  float cs = cos(-spin), sn = sin(-spin);
  loc = vec3(loc.x * cs - loc.z * sn, loc.y, loc.x * sn + loc.z * cs);
  nLocal = loc;
  lat = asin(clamp(loc.y, -1.0, 1.0));
  lon = atan(loc.z, loc.x);
}

/* ── planet surface colors (returns albedo; emissive & extras via out) ── */
vec3 planetAlbedo(int id, vec3 nl, float lat, float lon, out vec3 emissive, out float oceanMask, out float cloud) {
  emissive = vec3(0.0);
  oceanMask = 0.0;
  cloud = 0.0;
  vec3 p3 = nl * 3.0;

  if (id == 1) {            /* Mercury — cratered gray */
    float m = fbm(p3 * 2.4);
    float cr = ridged(p3 * 5.0);
    vec3 c = mix(vec3(0.32, 0.30, 0.28), vec3(0.55, 0.52, 0.48), m);
    c *= 0.75 + 0.35 * cr;
    return c;
  }
  if (id == 2) {            /* Venus — sulfuric cloud bands */
    float sw = fbm(vec3(nl.x * 2.0, nl.y * 6.0 + fbm(p3) * 1.5, nl.z * 2.0) + uTime * 0.004);
    vec3 c = mix(vec3(0.86, 0.72, 0.44), vec3(0.98, 0.90, 0.66), sw);
    return c;
  }
  if (id == 3) {            /* Earth */
    float cont = fbm(p3 * 1.35 + vec3(7.3));
    float landM = smoothstep(0.50, 0.56, cont);
    oceanMask = 1.0 - landM;
    float veg = fbm(p3 * 4.0 + vec3(2.0));
    vec3 land = mix(vec3(0.13, 0.30, 0.10), vec3(0.48, 0.40, 0.24), veg);
    /* deserts near tropics */
    land = mix(land, vec3(0.66, 0.54, 0.32), smoothstep(0.25, 0.45, abs(sin(lat * 2.2))) * smoothstep(0.4, 0.7, veg));
    vec3 ocean = mix(vec3(0.02, 0.09, 0.22), vec3(0.04, 0.16, 0.34), fbm(p3 * 2.0));
    vec3 c = mix(ocean, land, landM);
    /* ice caps */
    float ice = smoothstep(1.08, 1.22, abs(lat)) + smoothstep(0.62, 0.75, cont) * smoothstep(0.9, 1.15, abs(lat));
    c = mix(c, vec3(0.93, 0.95, 0.99), clamp(ice, 0.0, 1.0));
    /* clouds, drifting */
    cloud = smoothstep(0.52, 0.72, fbm(p3 * 2.6 + vec3(uTime * 0.006, 0.0, uTime * 0.0025)));
    c = mix(c, vec3(0.98), cloud * 0.9);
    /* night lights painted in main shading via emissive */
    float city = smoothstep(0.75, 0.95, fbm(p3 * 9.0 + vec3(4.7))) * landM * (1.0 - cloud) * (1.0 - clamp(ice, 0.0, 1.0));
    emissive = vec3(1.0, 0.75, 0.35) * city * 0.55; /* scaled by night factor later */
    return c;
  }
  if (id == 4) {            /* Moon — maria & highlands */
    float m = fbm(p3 * 2.2);
    float maria = smoothstep(0.55, 0.68, fbm(p3 * 1.1 + vec3(3.1)));
    float cr = ridged(p3 * 6.0);
    vec3 c = mix(vec3(0.50, 0.49, 0.47), vec3(0.24, 0.24, 0.25), maria);
    c *= 0.8 + 0.3 * m;
    c *= 0.85 + 0.25 * cr;
    return c;
  }
  if (id == 5) {            /* Mars */
    float m = fbm(p3 * 2.0);
    float dark = smoothstep(0.5, 0.65, fbm(p3 * 1.4 + vec3(8.8)));
    vec3 c = mix(vec3(0.72, 0.36, 0.18), vec3(0.45, 0.22, 0.12), dark);
    c *= 0.8 + 0.35 * m;
    float cap = smoothstep(1.22, 1.34, abs(lat));
    c = mix(c, vec3(0.95, 0.94, 0.92), cap);
    return c;
  }
  if (id == 6) {            /* Jupiter — bands + Great Red Spot */
    float turb = fbm(p3 * 2.6) * 0.35;
    float band = sin(lat * 13.0 + turb * 6.0 + fbm(p3 * 1.3) * 2.0);
    vec3 c = mix(vec3(0.80, 0.70, 0.55), vec3(0.55, 0.42, 0.30), band * 0.5 + 0.5);
    c = mix(c, vec3(0.93, 0.88, 0.78), smoothstep(0.6, 0.9, sin(lat * 6.5 + 1.4)) * 0.5);
    /* Great Red Spot */
    float dLat = (lat + 0.38) * 3.4;
    float dLon = sin((lon + 1.2 - uTime * 0.0004) * 0.5) * 2.6;
    float spot = exp(-(dLat * dLat + dLon * dLon) * 2.2);
    c = mix(c, vec3(0.72, 0.28, 0.16), spot * 0.85);
    c = mix(c, vec3(0.85, 0.5, 0.35), spot * fbm(p3 * 6.0) * 0.5);
    return c;
  }
  if (id == 7) {            /* Saturn — muted bands */
    float turb = fbm(p3 * 2.0) * 0.25;
    float band = sin(lat * 10.0 + turb * 4.0);
    vec3 c = mix(vec3(0.85, 0.76, 0.58), vec3(0.70, 0.60, 0.44), band * 0.5 + 0.5);
    c = mix(c, vec3(0.92, 0.86, 0.70), smoothstep(0.5, 1.0, sin(lat * 4.0 + 0.8)) * 0.35);
    return c;
  }
  if (id == 8) {            /* Uranus — near-featureless teal */
    float m = fbm(p3 * 1.6) * 0.12;
    return vec3(0.55, 0.78, 0.82) * (0.94 + m);
  }
  if (id == 9) {            /* Neptune — azure, storms, cirrus */
    float band = sin(lat * 7.0 + fbm(p3 * 1.8) * 2.0) * 0.5 + 0.5;
    vec3 c = mix(vec3(0.14, 0.28, 0.72), vec3(0.24, 0.42, 0.86), band);
    float dLat = (lat - 0.30) * 4.0;
    float dLon = sin((lon - 0.6) * 0.5) * 3.2;
    float spot = exp(-(dLat * dLat + dLon * dLon) * 2.6);
    c = mix(c, vec3(0.06, 0.12, 0.4), spot * 0.7);
    float cirrus = smoothstep(0.62, 0.8, fbm(p3 * 4.5 + vec3(uTime * 0.01, 0.0, 0.0)));
    c = mix(c, vec3(0.9, 0.95, 1.0), cirrus * 0.35);
    return c;
  }
  return vec3(0.5);
}

/* ── atmosphere rim tint per body ── */
vec3 atmosphereColor(int id, out float strength) {
  if (id == 3) { strength = 1.0;  return vec3(0.30, 0.55, 1.00); }
  if (id == 2) { strength = 0.9;  return vec3(0.95, 0.85, 0.55); }
  if (id == 5) { strength = 0.45; return vec3(0.80, 0.55, 0.35); }
  if (id == 6) { strength = 0.5;  return vec3(0.75, 0.65, 0.50); }
  if (id == 7) { strength = 0.5;  return vec3(0.85, 0.75, 0.55); }
  if (id == 8) { strength = 0.55; return vec3(0.55, 0.85, 0.85); }
  if (id == 9) { strength = 0.6;  return vec3(0.35, 0.55, 1.00); }
  strength = 0.0;
  return vec3(0.0);
}

/* ── the Sun's surface ── */
vec3 sunSurface(vec3 p, vec3 n, vec3 rd) {
  vec3 nl; float lat, lon;
  bodyLocal(0, p, nl, lat, lon);
  float g1 = fbm(nl * 14.0 + vec3(uTime * (0.06 + uActivity * 0.12)));
  float g2 = fbm(nl * 40.0 - vec3(uTime * 0.09));
  float gran = 0.72 + 0.38 * g1 + 0.18 * g2;
  float spots = smoothstep(0.68, 0.82, fbm(nl * 5.0 + vec3(31.7))) * (0.35 + uActivity * 0.5);
  float limb = pow(clamp(dot(n, -rd), 0.0, 1.0), 0.55);   /* limb darkening */
  vec3 c = mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.85, 0.5), gran);
  c = mix(c, vec3(0.55, 0.18, 0.05), spots);
  c *= 0.45 + 0.85 * limb;
  return c * (5.2 + uActivity * 3.5);
}

/* ── starfield & Milky Way ── */
vec3 background(vec3 rd) {
  vec3 col = vec3(0.0);
  /* two star layers — star radius stays well inside a hash cell so
     stars are round points, never clipped squares */
  for (int layer = 0; layer < 2; layer++) {
    float scale = layer == 0 ? 110.0 : 320.0;
    vec3 cell = floor(rd * scale);
    float h = hash13(cell);
    if (h > (layer == 0 ? 0.976 : 0.988)) {
      vec3 sp = (cell + 0.5 + (vec3(hash13(cell + 11.0), hash13(cell + 27.0), hash13(cell + 41.0)) - 0.5) * 0.55) / scale;
      float d = length(rd - normalize(sp));
      float rad = 0.30 / scale;
      float b = pow(smoothstep(rad, 0.0, d), 1.6);
      float mag = pow(hash13(cell + 5.0), 3.0);
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), hash13(cell + 66.0));
      col += tint * b * (layer == 0 ? 2.6 : 1.2) * (0.25 + mag);
    }
  }
  /* Milky Way band */
  vec3 gn = normalize(vec3(-0.35, 0.88, 0.32));      /* galactic pole, stylized */
  float band = 1.0 - abs(dot(rd, gn));
  float mw = smoothstep(0.75, 1.0, band);
  float dust = fbm(rd * 7.0 + vec3(3.0));
  float lanes = fbm(rd * 16.0 + vec3(9.0));
  vec3 mwCol = mix(vec3(0.10, 0.11, 0.16), vec3(0.24, 0.20, 0.24), dust);
  mwCol = mix(mwCol, vec3(0.30, 0.26, 0.22), smoothstep(0.5, 0.9, dust));
  mwCol *= 1.0 - smoothstep(0.45, 0.75, lanes) * 0.7;  /* dark dust lanes */
  col += mwCol * mw * (0.55 + 0.45 * dust);
  /* faint nebulae */
  float neb = fbm(rd * 3.0 + vec3(17.0));
  col += vec3(0.05, 0.03, 0.10) * smoothstep(0.6, 0.85, neb) * 0.5;
  col += vec3(0.010, 0.012, 0.02);                   /* zodiacal-ish floor */
  return col;
}

/* ── ring color at radius fraction q(0..1); returns rgb + alpha ── */
vec4 ringSample(float q) {
  float n1 = vnoise(vec3(q * 48.0, 0.5, 0.5));
  float n2 = vnoise(vec3(q * 140.0, 8.5, 0.5));
  float dens = 0.55 + 0.45 * n1;
  dens *= 0.8 + 0.2 * n2;
  /* Cassini division */
  dens *= 1.0 - 0.9 * smoothstep(0.585, 0.60, q) * smoothstep(0.665, 0.645, q);
  /* inner C-ring fade + outer edge */
  dens *= smoothstep(0.0, 0.12, q) * smoothstep(1.0, 0.94, q);
  vec3 c = mix(vec3(0.55, 0.48, 0.40), vec3(0.85, 0.78, 0.66), n1);
  return vec4(c, clamp(dens, 0.0, 1.0));
}

void main() {
  /* virtual-frame pixel (tiling support) */
  vec2 fragPx = uSubRect.xy + vUV * uSubRect.zw;
  vec2 ndc = (fragPx / uFullRes) * 2.0 - 1.0;
  float aspect = uFullRes.x / uFullRes.y;
  vec3 rd = normalize(uCamFwd + uCamRight * ndc.x * uFovTan * aspect + uCamUp * ndc.y * uFovTan);
  vec3 ro = uCamPos;

  /* nearest sphere */
  float tHit = 1e20;
  int hitId = -1;
  for (int i = 0; i < ${MAX_BODIES}; i++) {
    if (i >= uNumBodies) break;
    float t = iSphere(ro, rd, uBodyPosR[i].xyz, uBodyPosR[i].w);
    if (t > 0.0 && t < tHit) { tHit = t; hitId = i; }
  }

  /* Saturn's rings (single plane crossing) */
  float tRing = -1.0;
  float ringQ = 0.0;
  int satIdx = -1;
  for (int i = 1; i < ${MAX_BODIES}; i++) {
    if (i >= uNumBodies) break;
    if (uBodyMisc[i].z > 0.0) { satIdx = i; break; }
  }
  if (satIdx >= 0) {
    vec3 c = uBodyPosR[satIdx].xyz;
    vec3 ax = uBodyAxis[satIdx].xyz;
    float denom = dot(rd, ax);
    if (abs(denom) > 1e-6) {
      float t = dot(c - ro, ax) / denom;
      if (t > 0.0) {
        float r = length(ro + rd * t - c);
        if (r >= uBodyMisc[satIdx].y && r <= uBodyMisc[satIdx].z) {
          tRing = t;
          ringQ = (r - uBodyMisc[satIdx].y) / (uBodyMisc[satIdx].z - uBodyMisc[satIdx].y);
        }
      }
    }
  }

  vec3 col;
  float depthT = 1e19;

  /* base: surface or background */
  vec3 baseCol;
  if (hitId >= 0) {
    depthT = tHit;
    vec3 p = ro + rd * tHit;
    vec3 n = normalize(p - uBodyPosR[hitId].xyz);
    if (hitId == 0) {
      baseCol = sunSurface(p, n, rd);
    } else {
      int id = int(uBodyMisc[hitId].x + 0.5);
      vec3 nl; float lat, lon;
      bodyLocal(hitId, p, nl, lat, lon);
      vec3 emissive; float ocean, cloud;
      vec3 alb = planetAlbedo(id, nl, lat, lon, emissive, ocean, cloud);

      vec3 toSun = uBodyPosR[0].xyz - p;
      float dSun = length(toSun);
      vec3 L = toSun / dSun;
      float ndl = dot(n, L);
      float diff = max(ndl, 0.0);
      float vis = diff > 0.0 ? sunVisibility(p, hitId) : 0.0;
      if (satIdx >= 0 && hitId == satIdx) vis *= ringOcclusion(p, satIdx);

      float terminator = smoothstep(-0.12, 0.12, ndl);
      vec3 lit = alb * (diff * vis * 1.25);
      /* ocean specular */
      if (ocean > 0.0) {
        vec3 h = normalize(L - rd);
        float spec = pow(max(dot(n, h), 0.0), 90.0) * ocean * (1.0 - cloud) * vis;
        lit += vec3(1.0, 0.95, 0.8) * spec * 0.7;
      }
      /* soft ambient from starlight so night side isn't void-black */
      lit += alb * 0.012;
      /* city lights on the night side */
      lit += emissive * (1.0 - terminator);
      /* atmosphere rim */
      float aStr; vec3 aCol = atmosphereColor(id, aStr);
      float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.6);
      lit += aCol * rim * aStr * (0.10 + 0.85 * terminator * vis);
      baseCol = lit;
    }
  } else {
    baseCol = background(rd);
  }

  col = baseCol;

  /* composite rings over/under */
  if (tRing > 0.0 && tRing < tHit) {
    vec3 p = ro + rd * tRing;
    vec4 rs = ringSample(ringQ);
    float vis = sunVisibility(p, -1);
    float lit = 0.25 + 0.95 * vis;
    /* subtle unlit-side dimming */
    vec3 ax = uBodyAxis[satIdx].xyz;
    vec3 L = normalize(uBodyPosR[0].xyz - p);
    float sameSide = sign(dot(rd, ax)) == sign(-dot(L, ax)) ? 1.0 : 0.55;
    vec3 rc = rs.rgb * lit * sameSide;
    col = mix(col, rc, rs.a);
    depthT = min(depthT, tRing);
  }

#if BELT
  /* asteroid-belt dust specks on the ecliptic plane */
  if (uBeltOuter > 0.0 && abs(rd.y) > 1e-6) {
    float t = -ro.y / rd.y;
    if (t > 0.0 && t < depthT) {
      vec3 p = ro + rd * t;
      float r = length(p.xz);
      if (r > uBeltInner && r < uBeltOuter) {
        float q = (r - uBeltInner) / (uBeltOuter - uBeltInner);
        float fade = smoothstep(0.0, 0.25, q) * smoothstep(1.0, 0.75, q);
        float sp = smoothstep(0.94, 1.0, vnoise(p * 40.0)) * 0.5
                 + smoothstep(0.985, 1.0, vnoise(p * 160.0 + 31.0)) * 0.9;
        col += vec3(0.55, 0.5, 0.45) * sp * fade * 0.22;
      }
    }
  }
#endif

  /* sun glow (analytic corona) */
  {
    vec3 toSun = uBodyPosR[0].xyz - ro;
    float tc = dot(toSun, rd);
    if (tc > 0.0) {
      float h = length(toSun - rd * tc);
      float rs = uBodyPosR[0].w;
      float occluded = (depthT < tc && hitId != 0) ? 0.0 : 1.0;
      float g = rs / max(h, rs * 0.35);
      float glow = pow(clamp(g, 0.0, 1.0), 2.2) * (0.65 + uActivity * 0.9);
      /* streak flare */
      float ang = atan(dot(toSun - rd * tc, uCamUp), dot(toSun - rd * tc, uCamRight));
      glow *= 1.0 + 0.18 * pow(abs(cos(ang * 3.0)), 8.0);
      col += vec3(1.0, 0.72, 0.38) * glow * occluded * 1.15;
    }
  }

  /* depth for the vector overlay pass */
  if (depthT < 1e18) {
    vec4 clip = uVP * vec4(ro + rd * min(depthT, 1e6), 1.0);
    float d = clip.z / clip.w;
    gl_FragDepth = clamp(d * 0.5 + 0.5, 0.0, 1.0);
  } else {
    gl_FragDepth = 1.0;
  }

  fragColor = vec4(col, 1.0);
}`;
}

/* ── post-processing ── */
const POST_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomAmt;
uniform float uGrainAmt;
uniform float uTime;
uniform vec4 uBloomUV;   /* uv offset+scale into bloom tex (tiled stills) */
in vec2 vUV;
out vec4 fragColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 hdr = texture(uScene, vUV).rgb;
  vec2 buv = uBloomUV.xy + vUV * uBloomUV.zw;
  hdr += texture(uBloom, buv).rgb * uBloomAmt;
  vec3 c = aces(hdr * 0.85);
  c = pow(c, vec3(1.0 / 2.2));
  /* vignette */
  vec2 q = vUV - 0.5;
  c *= 1.0 - dot(q, q) * 0.55;
  /* grain */
  c += (hash12(vUV * 1731.0 + fract(uTime) * 917.0) - 0.5) * uGrainAmt;
  fragColor = vec4(c, 1.0);
}`;

const BRIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
in vec2 vUV;
out vec4 fragColor;
void main() {
  vec3 c = texture(uScene, vUV).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(c * smoothstep(0.85, 1.9, l), 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;   /* (1/w,0) or (0,1/h) */
in vec2 vUV;
out vec4 fragColor;
void main() {
  vec3 acc = texture(uTex, vUV).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153, o2 = uDir * 3.2307692;
  acc += (texture(uTex, vUV + o1).rgb + texture(uTex, vUV - o1).rgb) * 0.3162162;
  acc += (texture(uTex, vUV + o2).rgb + texture(uTex, vUV - o2).rgb) * 0.0702702;
  fragColor = vec4(acc, 1.0);
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main() {
  gl_Position = uVP * vec4(aPos, 1.0);
  gl_PointSize = 3.0;
}`;
const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
uniform float uIsPoint;
out vec4 fragColor;
void main() {
  float a = uColor.a;
  if (uIsPoint > 0.5) {
    float d = length(gl_PointCoord - 0.5);
    a *= smoothstep(0.5, 0.15, d);
  }
  fragColor = vec4(uColor.rgb * a, a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    throw new Error('Shader compile failed: ' + log + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).slice(0, 40).join('\n'));
  }
  return sh;
}
function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

/* minimal mat4 helpers (column-major) */
export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}
export function mat4View(pos, right, up, fwd) {
  /* camera basis → view matrix (fwd looks down -z) */
  const r = right, u = up, f = fwd;
  return new Float32Array([
    r[0], u[0], -f[0], 0,
    r[1], u[1], -f[1], 0,
    r[2], u[2], -f[2], 0,
    -(r[0] * pos[0] + r[1] * pos[1] + r[2] * pos[2]),
    -(u[0] * pos[0] + u[1] * pos[1] + u[2] * pos[2]),
    (f[0] * pos[0] + f[1] * pos[1] + f[2] * pos[2]),
    1,
  ]);
}
export function mat4Mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      powerPreference: 'high-performance',
      /* required for reliable captureStream/toBlob across browsers
         (Firefox samples the buffer outside the render task) */
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.hasFloat = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.maxRB = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_TEXTURE_SIZE));

    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.opt = { octaves: 5, softShadows: true, belt: true, grain: true, bloom: true, renderScale: 1 };
    this.sceneProgCache = new Map();
    this.postProg = link(gl, VERT_FS, POST_FS);
    this.brightProg = link(gl, VERT_FS, BRIGHT_FS);
    this.blurProg = link(gl, VERT_FS, BLUR_FS);
    this.lineProg = link(gl, LINE_VS, LINE_FS);
    this._uniformCache = new Map();
    this._buildSceneProg();

    this.fbo = { w: 0, h: 0 };
    this.paths = [];
    this.pointBuf = gl.createBuffer();
    this.pointCount = 0;
  }

  _buildSceneProg() {
    const key = `${this.opt.octaves}|${this.opt.softShadows}|${this.opt.belt}`;
    if (!this.sceneProgCache.has(key)) {
      this.sceneProgCache.set(key, link(this.gl, VERT_FS, sceneShaderSource(this.opt)));
    }
    this.sceneProg = this.sceneProgCache.get(key);
  }

  u(prog, name) {
    let m = this._uniformCache.get(prog);
    if (!m) { m = new Map(); this._uniformCache.set(prog, m); }
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(prog, name));
    return m.get(name);
  }

  setOptions(patch) {
    Object.assign(this.opt, patch);
    this._buildSceneProg();
    this._allocTargets(this.fbo.w, this.fbo.h, true);
  }

  _makeTex(w, h, internal, filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _allocTargets(w, h, force) {
    if (!force && this.fbo.w === w && this.fbo.h === h) return;
    const gl = this.gl;
    if (this.fbo.scene) {
      gl.deleteFramebuffer(this.fbo.scene);
      gl.deleteTexture(this.fbo.sceneTex);
      gl.deleteRenderbuffer(this.fbo.depth);
      for (const k of ['bloomA', 'bloomB']) { gl.deleteFramebuffer(this.fbo[k]); gl.deleteTexture(this.fbo[k + 'Tex']); }
    }
    const hdrFmt = this.hasFloat ? gl.RGBA16F : gl.RGBA8;
    this.fbo.w = w; this.fbo.h = h;
    this.fbo.sceneTex = this._makeTex(w, h, hdrFmt, gl.LINEAR);
    this.fbo.scene = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.scene);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbo.sceneTex, 0);
    this.fbo.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.fbo.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.fbo.depth);

    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.fbo.bw = bw; this.fbo.bh = bh;
    for (const k of ['bloomA', 'bloomB']) {
      this.fbo[k + 'Tex'] = this._makeTex(bw, bh, hdrFmt, gl.LINEAR);
      this.fbo[k] = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[k]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbo[k + 'Tex'], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const s = this.opt.renderScale;
    this._allocTargets(
      Math.min(this.maxRB, Math.max(2, Math.round(w * s))),
      Math.min(this.maxRB, Math.max(2, Math.round(h * s))),
      false
    );
  }

  setPaths(paths) {
    /* paths: [{points: Float32Array, color:[r,g,b], alpha}] */
    const gl = this.gl;
    for (const p of this.paths) gl.deleteBuffer(p.buf);
    this.paths = paths.map((p) => {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, p.points, gl.STATIC_DRAW);
      return { buf, n: p.points.length / 3, color: p.color, alpha: p.alpha };
    });
  }

  setPoints(arr) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
    this.pointCount = arr.length / 3;
  }

  _sceneUniforms(frame, fullW, fullH, subX, subY, subW, subH) {
    const gl = this.gl, pr = this.sceneProg;
    gl.uniform2f(this.u(pr, 'uResolution'), subW, subH);
    gl.uniform4f(this.u(pr, 'uSubRect'), subX, subY, subW, subH);
    gl.uniform2f(this.u(pr, 'uFullRes'), fullW, fullH);
    gl.uniform3fv(this.u(pr, 'uCamPos'), frame.camPos);
    gl.uniform3fv(this.u(pr, 'uCamRight'), frame.right);
    gl.uniform3fv(this.u(pr, 'uCamUp'), frame.up);
    gl.uniform3fv(this.u(pr, 'uCamFwd'), frame.fwd);
    gl.uniform1f(this.u(pr, 'uFovTan'), Math.tan(frame.fovY / 2));
    gl.uniform1f(this.u(pr, 'uTime'), frame.timeSec);
    gl.uniform1f(this.u(pr, 'uActivity'), frame.sunActivity || 0);
    gl.uniformMatrix4fv(this.u(pr, 'uVP'), false, frame.vp);
    gl.uniform1i(this.u(pr, 'uNumBodies'), frame.bodies.length);
    const posR = new Float32Array(MAX_BODIES * 4);
    const axis = new Float32Array(MAX_BODIES * 4);
    const misc = new Float32Array(MAX_BODIES * 4);
    frame.bodies.forEach((b, i) => {
      posR.set([b.pos[0], b.pos[1], b.pos[2], b.radius], i * 4);
      axis.set([b.axis[0], b.axis[1], b.axis[2], b.spin], i * 4);
      misc.set([b.shaderId, b.ringInner || 0, b.ringOuter || 0, 0], i * 4);
    });
    gl.uniform4fv(this.u(pr, 'uBodyPosR'), posR);
    gl.uniform4fv(this.u(pr, 'uBodyAxis'), axis);
    gl.uniform4fv(this.u(pr, 'uBodyMisc'), misc);
    gl.uniform1f(this.u(pr, 'uBeltInner'), frame.beltInner || 0);
    gl.uniform1f(this.u(pr, 'uBeltOuter'), frame.beltOuter || 0);
  }

  _drawOverlays(frame) {
    const gl = this.gl;
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(this.u(this.lineProg, 'uVP'), false, frame.vp);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    if (frame.showOrbits) {
      for (const p of this.paths) {
        gl.bindBuffer(gl.ARRAY_BUFFER, p.buf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.uniform4f(this.u(this.lineProg, 'uColor'), p.color[0], p.color[1], p.color[2], p.alpha);
        gl.uniform1f(this.u(this.lineProg, 'uIsPoint'), 0);
        gl.drawArrays(gl.LINE_STRIP, 0, p.n);
      }
    }
    if (this.pointCount > 0 && frame.showPoints) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniform4f(this.u(this.lineProg, 'uColor'), 1.0, 0.75, 0.4, 0.9);
      gl.uniform1f(this.u(this.lineProg, 'uIsPoint'), 1);
      gl.drawArrays(gl.POINTS, 0, this.pointCount);
    }
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  _renderScenePass(frame, fbo, w, h, fullW, fullH, subX, subY) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);       /* raytracer writes every pixel + depth */
    gl.useProgram(this.sceneProg);
    gl.bindVertexArray(this.quad);
    this._sceneUniforms(frame, fullW, fullH, subX, subY, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.DEPTH_TEST);
  }

  _bloomPass() {
    const gl = this.gl, f = this.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.bloomA);
    gl.viewport(0, 0, f.bw, f.bh);
    gl.useProgram(this.brightProg);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.sceneTex);
    gl.uniform1i(this.u(this.brightProg, 'uScene'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(this.blurProg);
    gl.uniform1i(this.u(this.blurProg, 'uTex'), 0);
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.bloomB);
      gl.bindTexture(gl.TEXTURE_2D, f.bloomATex);
      gl.uniform2f(this.u(this.blurProg, 'uDir'), 1 / f.bw, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.bloomA);
      gl.bindTexture(gl.TEXTURE_2D, f.bloomBTex);
      gl.uniform2f(this.u(this.blurProg, 'uDir'), 0, 1 / f.bh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
  }

  _composite(targetFbo, tw, th, frame, bloomUV) {
    const gl = this.gl, f = this.fbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
    gl.viewport(0, 0, tw, th);
    gl.useProgram(this.postProg);
    gl.bindVertexArray(this.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, f.sceneTex);
    gl.uniform1i(this.u(this.postProg, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, f.bloomATex);
    gl.uniform1i(this.u(this.postProg, 'uBloom'), 1);
    gl.uniform1f(this.u(this.postProg, 'uBloomAmt'), this.opt.bloom ? 0.85 : 0.0);
    gl.uniform1f(this.u(this.postProg, 'uGrainAmt'), this.opt.grain ? 0.015 : 0.0);
    gl.uniform1f(this.u(this.postProg, 'uTime'), frame.timeSec % 1000);
    const b = bloomUV || [0, 0, 1, 1];
    gl.uniform4f(this.u(this.postProg, 'uBloomUV'), b[0], b[1], b[2], b[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  render(frame) {
    const gl = this.gl, f = this.fbo;
    this._renderScenePass(frame, f.scene, f.w, f.h, f.w, f.h, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.scene);
    gl.viewport(0, 0, f.w, f.h);
    this._drawOverlays(frame);
    if (this.opt.bloom) this._bloomPass();
    this._composite(null, this.canvas.width, this.canvas.height, frame);
  }

  /* ── tiled hi-res still: returns a 2D canvas of w×h ──
     Bloom is built once from a preview-resolution pass, then sampled
     per tile (bloom is low-frequency, so this composes seamlessly). */
  async renderStill(w, h, frame, onProgress) {
    const gl = this.gl;
    const prev = { w: this.fbo.w, h: this.fbo.h };
    this.exporting = true;           /* main loop pauses live rendering */
    try {
      return await this._renderStillInner(w, h, frame, onProgress, prev);
    } finally {
      this.exporting = false;
    }
  }

  async _renderStillInner(w, h, frame, onProgress, prev) {
    const gl = this.gl;

    /* 1 — preview pass for bloom */
    const pw = Math.min(1600, w), ph = Math.max(2, Math.round(pw * h / w));
    this._allocTargets(pw, ph, true);
    this._renderScenePass(frame, this.fbo.scene, pw, ph, pw, ph, 0, 0);
    if (this.opt.bloom) this._bloomPass();

    /* keep bloom textures aside */
    const keepBloomTex = this.fbo.bloomATex;
    const keepBloomFbo = this.fbo.bloomA;
    this.fbo.bloomATex = this._makeTex(2, 2, this.hasFloat ? gl.RGBA16F : gl.RGBA8, gl.LINEAR);
    this.fbo.bloomA = gl.createFramebuffer();

    /* 2 — tile through the full frame */
    const tile = Math.min(2048, this.maxRB);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    const outFbo = gl.createFramebuffer();
    const outTex = this._makeTex(tile, tile, gl.RGBA8, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);

    const cols = Math.ceil(w / tile), rows = Math.ceil(h / tile);
    let done = 0;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const x0 = tx * tile, y0 = ty * tile;
        const tw = Math.min(tile, w - x0), th = Math.min(tile, h - y0);
        this._allocTargets(tw, th, true);
        /* scene pass for this tile (gl y-up ⇒ flip row index) */
        const glY0 = h - y0 - th;
        this._renderScenePass(frame, this.fbo.scene, tw, th, w, h, x0, glY0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.scene);
        gl.viewport(0, 0, tw, th);
        /* overlays skipped in stills: pure rendered scene */

        /* composite with preview bloom mapped to this tile */
        const oldTex = this.fbo.bloomATex;
        this.fbo.bloomATex = keepBloomTex;
        this._composite(outFbo, tw, th, frame, [x0 / w, glY0 / h, tw / w, th / h]);
        this.fbo.bloomATex = oldTex;

        const px = new Uint8Array(tw * th * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
        gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const img = ctx.createImageData(tw, th);
        /* flip vertically: gl rows are bottom-up */
        for (let r = 0; r < th; r++) {
          img.data.set(px.subarray((th - 1 - r) * tw * 4, (th - r) * tw * 4), r * tw * 4);
        }
        ctx.putImageData(img, x0, y0);
        done++;
        if (onProgress) onProgress(done / (cols * rows));
        await new Promise((res) => setTimeout(res, 0));  /* keep UI alive */
      }
    }

    gl.deleteFramebuffer(outFbo);
    gl.deleteTexture(outTex);
    gl.deleteTexture(keepBloomTex);
    gl.deleteFramebuffer(keepBloomFbo);
    this._allocTargets(prev.w, prev.h, true);
    return out;
  }

  /* CPU ray pick: returns body index or -1 */
  pick(px, py, frame) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const ndcX = (px / w) * 2 - 1;
    const ndcY = 1 - (py / h) * 2;
    const t = Math.tan(frame.fovY / 2);
    const aspect = w / h;
    const rd = [
      frame.fwd[0] + frame.right[0] * ndcX * t * aspect + frame.up[0] * ndcY * t,
      frame.fwd[1] + frame.right[1] * ndcX * t * aspect + frame.up[1] * ndcY * t,
      frame.fwd[2] + frame.right[2] * ndcX * t * aspect + frame.up[2] * ndcY * t,
    ];
    const len = Math.hypot(rd[0], rd[1], rd[2]);
    rd[0] /= len; rd[1] /= len; rd[2] /= len;
    let best = -1, bestT = Infinity;
    frame.bodies.forEach((b, i) => {
      const oc = [frame.camPos[0] - b.pos[0], frame.camPos[1] - b.pos[1], frame.camPos[2] - b.pos[2]];
      const bq = oc[0] * rd[0] + oc[1] * rd[1] + oc[2] * rd[2];
      const r = b.radius * 1.6 + 0.004 * Math.abs(bq); /* generous pick radius */
      const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - r * r;
      const disc = bq * bq - c;
      if (disc < 0) return;
      const tHit = -bq - Math.sqrt(disc);
      if (tHit > 0 && tHit < bestT) { bestT = tHit; best = i; }
    });
    return best;
  }
}
