import os
import math
from PIL import Image, ImageDraw, ImageFont

output_dir = os.path.join(os.getcwd(), "sites", "pumprun")
os.makedirs(output_dir, exist_ok=True)

# 1. Generate dexscreener-icon.png (500x500, 1:1 Aspect Ratio)
def create_icon():
    w, h = 500, 500
    img = Image.new("RGBA", (w, h), (7, 8, 11, 255))
    draw = ImageDraw.Draw(img)

    # Background gradient / glow circle
    cx, cy = w // 2, h // 2
    for r in range(220, 0, -5):
        alpha = int(35 * (1 - r / 220))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 0, 122, alpha))

    # Inner circle
    draw.ellipse([cx - 180, cy - 180, cx + 180, cy + 180], fill=(15, 23, 42, 255), outline=(0, 255, 136, 255), width=6)

    # Neon running silhouette / icon
    # Draw a stylish runner stickman/character in neon green (#00FF88)
    green = (0, 255, 136, 255)
    pink = (255, 0, 122, 255)
    
    # Head
    draw.ellipse([cx + 10, cy - 120, cx + 70, cy - 60], fill=green)
    
    # Body
    draw.line([cx + 30, cy - 65, cx - 10, cy + 30], fill=green, width=16)
    
    # Arms (pumping)
    draw.line([cx + 20, cy - 40, cx - 40, cy - 20], fill=green, width=12)
    draw.line([cx - 40, cy - 20, cx - 30, cy - 70], fill=green, width=12)
    draw.line([cx + 25, cy - 40, cx + 80, cy - 10], fill=green, width=12)
    draw.line([cx + 80, cy - 10, cx + 90, cy + 20], fill=green, width=12)
    
    # Legs (sprinting)
    draw.line([cx - 10, cy + 30, cx + 60, cy + 60], fill=green, width=14)
    draw.line([cx + 60, cy + 60, cx + 90, cy + 130], fill=green, width=14)
    draw.line([cx - 10, cy + 30, cx - 70, cy + 80], fill=green, width=14)
    draw.line([cx - 70, cy + 80, cx - 120, cy + 60], fill=green, width=14)

    # Bullish hill curve under feet
    draw.arc([cx - 200, cy + 30, cx + 220, cy + 250], start=180, end=360, fill=(255, 183, 3, 255), width=8)

    # Badge text "$PUMPRUN" at bottom
    # Draw simple readable text box
    draw.rounded_rectangle([cx - 120, cy + 150, cx + 120, cy + 185], radius=10, fill=(0, 0, 0, 230), outline=pink, width=2)
    
    try:
        font = ImageFont.truetype("arial.ttf", 22)
    except:
        font = ImageFont.load_default()
    
    draw.text((cx, cy + 167), "$PUMPRUN", fill=(255, 255, 255, 255), font=font, anchor="mm")

    icon_path = os.path.join(output_dir, "dexscreener-icon.png")
    img.save(icon_path, "PNG")
    print(f"✅ Icon generated: {icon_path} (500x500, 1:1)")

# 2. Generate dexscreener-header.png (1500x500, 3:1 Aspect Ratio)
def create_header():
    w, h = 1500, 500
    img = Image.new("RGBA", (w, h), (5, 6, 10, 255))
    draw = ImageDraw.Draw(img)

    # Cyber grid lines on bottom half
    for x in range(0, w, 60):
        draw.line([x, 250, x - 200, h], fill=(20, 30, 50, 100), width=1)
    for y in range(250, h, 30):
        draw.line([0, y, w, y], fill=(20, 30, 50, 100), width=1)

    # Bullish green candlestick chart background
    candles = [
        (100, 380, 420, 340, 440, True),
        (220, 350, 390, 320, 410, True),
        (340, 330, 310, 290, 350, True),
        (460, 300, 260, 240, 320, True),
        (580, 270, 220, 200, 290, True),
        (700, 230, 170, 150, 250, True),
        (820, 180, 140, 120, 200, True),
        (940, 150, 100, 80, 170, True),
        (1060, 120, 70, 50, 140, True),
        (1180, 90, 40, 20, 110, True),
        (1300, 60, 20, 10, 80, True),
    ]
    for c in candles:
        x, o, close_p, high_p, low_p, is_green = c
        color = (0, 255, 136, 120) if is_green else (255, 0, 80, 120)
        draw.line([x, high_p, x, low_p], fill=color, width=3)
        top = min(o, close_p)
        bottom = max(o, close_p)
        draw.rectangle([x - 18, top, x + 18, bottom], fill=color)

    # Glow in center
    for r in range(400, 0, -10):
        alpha = int(25 * (1 - r / 400))
        draw.ellipse([750 - r, 220 - r // 2, 750 + r, 220 + r // 2], fill=(255, 0, 122, alpha))

    # Bold Typography
    try:
        title_font = ImageFont.truetype("arialbd.ttf", 64)
        sub_font = ImageFont.truetype("arialbd.ttf", 26)
        pill_font = ImageFont.truetype("arial.ttf", 20)
    except:
        title_font = ImageFont.load_default()
        sub_font = ImageFont.load_default()
        pill_font = ImageFont.load_default()

    # Title: PUMP HILL RUNNER ($PUMPRUN)
    draw.text((750, 160), "PUMP HILL RUNNER", fill=(255, 255, 255, 255), font=title_font, anchor="mm")
    draw.text((750, 230), "THE AUTONOMOUS GREEN RUNNER OF WEB3 ON BASE L2", fill=(0, 255, 136, 255), font=sub_font, anchor="mm")

    # Feature badges / pills
    badges = [
        ("0% TAX (BUY/SELL)", (0, 255, 136)),
        ("30% AUTO BUYBACK & BURN", (255, 0, 122)),
        ("BASE MAINNET L2", (0, 150, 255)),
        ("DOPPLER V4 PROTOCOL", (255, 183, 3))
    ]
    total_w = 4 * 240
    start_x = 750 - total_w // 2 + 120
    for idx, (text, col) in enumerate(badges):
        bx = start_x + idx * 260
        by = 310
        draw.rounded_rectangle([bx - 120, by - 20, bx + 120, by + 20], radius=12, fill=(10, 15, 25, 230), outline=(*col, 200), width=2)
        draw.text((bx, by), text, fill=(255, 255, 255, 255), font=pill_font, anchor="mm")

    # Footer note on banner
    draw.text((750, 420), "Official Website: pumprun-web3.pages.dev  |  Contract: 0x0a99f4251A461e8abC693a56BB837fD815D51BA3", fill=(180, 190, 210, 255), font=pill_font, anchor="mm")

    header_path = os.path.join(output_dir, "dexscreener-header.png")
    img.save(header_path, "PNG")
    print(f"✅ Header generated: {header_path} (1500x500, 3:1)")

create_icon()
create_header()
