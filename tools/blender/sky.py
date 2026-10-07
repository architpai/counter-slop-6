"""
Physical skies for the realistic tiers (docs/VISUALS.md, R1).

Renders each map mood's sky with Blender's physical sky (Multiple Scattering)
and the sun where that map's `sunDir` puts it, then writes, per map:

  public/sky/<map>/env.hdr    1024 x 512 RGBE equirect, the PMREM environment source (three
                              makes a 256 cube from it, the size of the RoomEnvironment Low
                              uses, so the sky landing changes no shader program)
  public/sky/<map>/sky.webp   2048 x 1024 sRGB equirect, the visible sky (lossless WebP)
  public/sky/<map>/sky.json   sun irradiance, sky irradiance as 9 SH coefficients,
                              the horizon (fog) colour and the background scale

Both images use three.js's equirect layout (u = atan(z, x) / 2pi + 0.5, top row
straight up), in three's axes (y up). No sun disc is drawn into either image:
the directional light is the sun, and the dome shader draws its disc. Below
the horizon, the environment sees a neutral grey floor as bright as the map's
own sunlit ground (bounce light), and the visible sky repeats the colour of the
lowest degree above the horizon, which is also the fog colour, so the sky
meets the fog without a step.

Units: every radiance and irradiance is scaled so a white horizontal surface
in full sun (sun plus sky) has radiance 1, i.e. its irradiance is pi. So the
game's light intensities come straight from the atmosphere model, and the
per-map `exposure` in the mood only sets the look.

Regenerate (a few seconds; the sun direction must match each level's mood):

  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/sky.py
  /opt/homebrew/bin/blender --background --factory-startup --python tools/blender/sky.py -- downtown

The unit test `tests/sky.test.ts` fails when a mood's sunDir and its sky.json disagree.
"""

import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Sun directions in three's axes (towards the sun, any length), copied from each level's mood.
# Training has no sunDir in its mood, so it uses the renderer default (render/index.ts SUN_DIR).
# Atmosphere: air and aerosol densities (1 = Blender's clear-day default) and the planet's ground
# albedo. `floor` is the albedo (luminance) of the map's own ground, which lights everything from
# below. Grey on purpose: the probe cannot tell indoors from out, and a lawn's green bounce turned
# every ceiling and eave underside olive. The warm or cool mood comes from the game's grade and haze.
MAPS = {
    # A cool, clear morning: thin aerosol, a deep blue zenith; grey paving and asphalt.
    'downtown': {'sun': (-90, 115, -160), 'air': 1.0, 'aerosol': 0.6, 'ozone': 1.0, 'ground': 0.25, 'floor': 0.29},
    # A warm, slightly hazy late afternoon over lawns (the physical sky at this sun height is
    # plain daylight; the game's grade and horizon haze make it warm).
    'house': {'sun': (150, 153, 160), 'air': 1.0, 'aerosol': 1.6, 'ozone': 1.0, 'ground': 0.3, 'floor': 0.18},
    # Sun-baked and dusty: more aerosol whitens the horizon; sand underfoot.
    'mexico': {'sun': (70, 105, -150), 'air': 1.0, 'aerosol': 2.4, 'ozone': 1.0, 'ground': 0.4, 'floor': 0.37},
    'training': {'sun': (0.38, 0.82, 0.42), 'air': 1.0, 'aerosol': 1.0, 'ozone': 1.0, 'ground': 0.3, 'floor': 0.32},
}

WIDTH, HEIGHT = 2048, 1024
ENV_WIDTH, ENV_HEIGHT = 1024, 512
SUN_RES = 96
# Share of the sunlit floor's radiance the environment sees from below (see build()).
BOUNCE = 0.3
LUMA = np.array([0.2126, 0.7152, 0.0722])


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def to_blender(d):
    """three (x, y up, z) to Blender (x, y, z up)."""
    return np.array([d[0], -d[2], d[1]])


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 4
    scene.cycles.use_denoising = False
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.resolution_percentage = 100
    world = bpy.data.worlds.new('sky')
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    nodes.clear()
    sky = nodes.new('ShaderNodeTexSky')
    background = nodes.new('ShaderNodeBackground')
    output = nodes.new('ShaderNodeOutputWorld')
    world.node_tree.links.new(sky.outputs['Color'], background.inputs['Color'])
    world.node_tree.links.new(background.outputs['Background'], output.inputs['Surface'])
    camera = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene, sky, camera


def set_sky(sky, spec, disc):
    b = to_blender(unit(spec['sun']))
    sky.sky_type = 'MULTIPLE_SCATTERING'
    sky.sun_elevation = math.asin(b[2])
    # The sun lands at (cos(e) sin(r), cos(e) cos(r), sin(e)); check_sun verifies it on every run.
    sky.sun_rotation = math.atan2(b[0], b[1]) % (2 * math.pi)
    sky.sun_disc = disc
    sky.sun_intensity = 1.0
    sky.altitude = 100.0
    sky.air_density = spec['air']
    sky.aerosol_density = spec['aerosol']
    sky.ozone_density = spec['ozone']
    sky.ground_albedo = spec['ground']


def render(scene, width, height):
    """Render the current camera to float RGB, rows top to bottom."""
    scene.render.resolution_x, scene.render.resolution_y = width, height
    path = os.path.join(tempfile.gettempdir(), 'cs6-sky-render.exr')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(path, check_existing=False)
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)[::-1, :, :3].astype(np.float64)


def render_equirect(scene, camera, width, height):
    camera.data.type = 'PANO'
    camera.data.panorama_type = 'EQUIRECTANGULAR'
    # Looking down Blender +x (three +x) with z up: the image centre is three's u = 0.5,
    # and the left half is Blender +y (three -z), as in three's equirect layout.
    camera.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    camera.location = (0, 0, 0)
    return render(scene, width, height)


def directions(width, height):
    """Unit direction (three axes) and solid angle of every equirect pixel, rows top to bottom."""
    u = (np.arange(width) + 0.5) / width
    v = 1 - (np.arange(height) + 0.5) / height
    phi = (u - 0.5) * 2 * math.pi
    lat = (v - 0.5) * math.pi
    phi, lat = np.meshgrid(phi, lat)
    d = np.stack([np.cos(lat) * np.cos(phi), np.sin(lat), np.cos(lat) * np.sin(phi)], axis=-1)
    omega = (2 * math.pi / width) * (math.pi / height) * np.cos(lat)
    return d, omega


def sun_irradiance(scene, sky, camera, spec):
    """Normal irradiance of the sun disc alone: a narrow view on the sun, disc minus no disc."""
    fov = math.radians(2.0)
    camera.data.type = 'PERSP'
    camera.data.sensor_fit = 'HORIZONTAL'
    camera.data.angle = fov
    b = to_blender(unit(spec['sun']))
    # A camera looks down its -z; aim it along the sun with z up.
    camera.rotation_mode = 'QUATERNION'
    camera.rotation_quaternion = Vector(b).to_track_quat('-Z', 'Y')
    set_sky(sky, spec, True)
    lit = render(scene, SUN_RES, SUN_RES)
    set_sky(sky, spec, False)
    bare = render(scene, SUN_RES, SUN_RES)
    camera.rotation_mode = 'XYZ'
    pixel = (2 * math.tan(fov / 2) / SUN_RES) ** 2
    return np.clip(lit - bare, 0, None).reshape(-1, 3).sum(axis=0) * pixel


def check_sun(scene, sky, camera, spec):
    """The disc must land where three's equirect lookup expects the sun."""
    set_sky(sky, spec, True)
    image = render_equirect(scene, camera, 512, 256)
    row, col = np.unravel_index(np.argmax(image @ LUMA), image.shape[:2])
    d, _ = directions(512, 256)
    angle = math.degrees(math.acos(np.clip(d[row, col] @ unit(spec['sun']), -1, 1)))
    if angle > 1.5:
        raise SystemExit(f'sun disc at {d[row, col]} is {angle:.1f} deg off the mood direction {unit(spec["sun"])}')


def sh9(radiance, d, omega):
    """Radiance projected onto three's real SH basis (SphericalHarmonics3.getBasisAt)."""
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    basis = [
        0.282095 * np.ones_like(x),
        0.488603 * y, 0.488603 * z, 0.488603 * x,
        1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1),
        1.092548 * x * z, 0.546274 * (x * x - y * y),
    ]
    return [(radiance * (b * omega)[..., None]).reshape(-1, 3).sum(axis=0) for b in basis]


def downsample(image, factor):
    h, w, c = image.shape
    return image.reshape(h // factor, factor, w // factor, factor, c).mean(axis=(1, 3))


def srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)


def save(pixels, path, file_format, is_float, quality=100):
    """Write rows-top-to-bottom RGB through a Blender image (it flips to bottom-up)."""
    height, width = pixels.shape[:2]
    image = bpy.data.images.new('out', width, height, alpha=False, float_buffer=is_float)
    image.colorspace_settings.name = 'Linear Rec.709' if is_float else 'Non-Color'
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[..., :3] = pixels[::-1]
    image.pixels.foreach_set(rgba.ravel())
    scene = bpy.context.scene
    settings = scene.render.image_settings
    settings.file_format = file_format
    settings.color_mode = 'RGB'
    if file_format == 'WEBP':
        settings.quality = quality
        settings.color_depth = '8'
    image.save_render(path, scene=scene)
    bpy.data.images.remove(image)
    settings.file_format = 'OPEN_EXR'
    settings.color_depth = '32'


def build(key):
    spec = MAPS[key]
    scene, sky, camera = reset()
    check_sun(scene, sky, camera, spec)
    e_sun = sun_irradiance(scene, sky, camera, spec)
    set_sky(sky, spec, False)
    radiance = render_equirect(scene, camera, WIDTH, HEIGHT)
    d, omega = directions(WIDTH, HEIGHT)
    sun = unit(spec['sun'])
    e_sky_up = (radiance * (np.clip(d[..., 1], 0, None) * omega)[..., None]).reshape(-1, 3).sum(axis=0)
    # A white horizontal surface in full sun gets radiance 1 (irradiance pi).
    scale = math.pi / float((e_sun * sun[1] + e_sky_up) @ LUMA)
    radiance *= scale
    e_sun *= scale
    lat = np.degrees(np.arcsin(np.clip(d[..., 1], -1, 1)))
    # The lowest degree: a wider band averages in the bluer sky above and leaves a step where
    # the sky meets the fog.
    horizon = radiance[(lat >= 0) & (lat <= 1)].mean(axis=0)
    # Below the horizon the planet's distant ground is replaced. The environment sees the map's
    # own floor, hazed into the horizon over 8 degrees: the bounce light on shaded walls and on
    # enemies' undersides. A sunlit floor's radiance is its albedo (its irradiance is pi), but
    # the probe lights interiors and undersides too, where little of that floor is in view, so
    # only BOUNCE of it counts. The visible sky shows the horizon colour below the horizon,
    # which is what the fog fades to anyway.
    below = lat < 0
    haze = np.clip(-lat / 8, 0, 1)[..., None]
    floor = np.full(3, spec['floor'] * BOUNCE)
    lit = np.where(below[..., None], horizon * (1 - haze) + floor * haze, radiance)
    visible = np.where(below[..., None], horizon, radiance)
    # The background keeps its brightest 0.2 % (the halo around the sun) at white.
    peak = float(np.percentile((visible @ LUMA)[lat > -2], 99.8))
    out = os.path.join(ROOT, 'public', 'sky', key)
    os.makedirs(out, exist_ok=True)
    env = downsample(lit, WIDTH // ENV_WIDTH)
    save(env, os.path.join(out, 'env.hdr'), 'HDR', True)
    save(srgb(visible / peak), os.path.join(out, 'sky.webp'), 'WEBP', False, 100)
    record = {
        'map': key,
        'generator': 'tools/blender/sky.py (Blender physical sky, Multiple Scattering)',
        'sunDir': [round(float(v), 5) for v in sun],
        'atmosphere': {k: spec[k] for k in ('air', 'aerosol', 'ozone', 'ground', 'floor')},
        'sun': [round(float(v), 5) for v in e_sun],
        'sh': [[round(float(v), 5) for v in c] for c in sh9(lit, d, omega)],
        'fog': [round(float(v), 5) for v in horizon],
        'background': round(peak, 5),
    }
    with open(os.path.join(out, 'sky.json'), 'w') as file:
        # One line per field keeps the diff of a re-render readable.
        file.write('{\n' + ',\n'.join(f'  {json.dumps(k)}: {json.dumps(v)}' for k, v in record.items()) + '\n}\n')
    sizes = {name: os.path.getsize(os.path.join(out, name)) for name in ('env.hdr', 'sky.webp', 'sky.json')}
    sky_share = float((e_sky_up * scale) @ LUMA) / math.pi
    print(f'SKY {key}: sun {record["sun"]} sky share {sky_share:.2f} fog {record["fog"]} '
          f'background {peak:.3f} bytes {sizes}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for key in argv or list(MAPS):
        if key not in MAPS:
            raise SystemExit(f'unknown map {key}; one of {", ".join(MAPS)}')
        build(key)


main()
