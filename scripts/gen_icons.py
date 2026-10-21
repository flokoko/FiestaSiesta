from PIL import Image, ImageDraw, ImageFilter
import math

def create_icon(size, path):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background: Italian flag (green | white | red vertical stripes)
    green = (0, 146, 70, 255)
    white = (255, 255, 255, 255)
    red = (206, 43, 55, 255)

    stripe_w = size // 3
    # Green (left third)
    draw.rectangle([0, 0, stripe_w, size-1], fill=green)
    # White (center third)
    draw.rectangle([stripe_w, 0, stripe_w*2, size-1], fill=white)
    # Red (right third)
    draw.rectangle([stripe_w*2, 0, size-1, size-1], fill=red)

    # Rounded corners
    radius = int(size * 0.22)
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle([0, 0, size-1, size-1], radius=radius, fill=255)
    img.putalpha(mask)

    cx, cy = size // 2, size // 2

    # Mozzarella ball (white, slightly cream)
    r = int(size * 0.34)

    # Soft shadow under the cheese
    shadow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse([cx-r+4, cy-r+6, cx+r+4, cy+r+6], fill=(0, 0, 0, 50))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=int(size*0.04)))
    img = Image.alpha_composite(img, shadow)
    draw = ImageDraw.Draw(img)

    # Main mozzarella ball - cream white
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(252, 247, 230, 255))

    # Subtle gradient highlight (top-left lighter)
    highlight = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    hl_draw = ImageDraw.Draw(highlight)
    hl_r = int(r * 0.85)
    hl_draw.ellipse([cx-r, cy-r, cx-r+hl_r*2, cy-r+hl_r*2], fill=(255, 252, 240, 80))
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=int(size*0.08)))
    img = Image.alpha_composite(img, highlight)

    # Redraw edge
    draw = ImageDraw.Draw(img)
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], outline=(240, 230, 200, 255), width=max(1, int(size*0.008)))

    # Mozzarella characteristic holes (bubbles)
    holes = [
        (cx - r*0.35, cy - r*0.30, 0.030),
        (cx + r*0.28, cy - r*0.10, 0.025),
        (cx - r*0.05, cy + r*0.35, 0.035),
        (cx + r*0.40, cy + r*0.30, 0.020),
        (cx - r*0.25, cy + r*0.10, 0.018),
    ]

    for hx, hy, hr_ratio in holes:
        hr = int(size * hr_ratio)
        # Recessed look: darker center, lighter rim
        draw.ellipse([hx-hr, hy-hr, hx+hr, hy+hr], fill=(220, 210, 185, 255))
        inner_r = max(1, hr - 2)
        draw.ellipse([hx-inner_r, hy-inner_r, hx+inner_r, hy+inner_r], fill=(240, 233, 210, 200))

    img.save(path, 'PNG')
    print(f"Created {path} ({size}x{size})")

create_icon(192, '/opt/data/urlaubsliste/public/icon-192.png')
create_icon(512, '/opt/data/urlaubsliste/public/icon-512.png')
create_icon(180, '/opt/data/urlaubsliste/public/apple-touch-icon.png')
print("All icons created!")