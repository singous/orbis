from __future__ import annotations

import io
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_PIXELS = 4096 * 4096
THUMBNAIL_SIZE = (256, 256)
ALLOWED_IMAGE_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})


class InvalidThumbnail(Exception):
    pass


def normalize_thumbnail(contents: bytes, *, square: bool = False) -> bytes:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(contents)) as source:
                if (
                    source.format not in ALLOWED_IMAGE_FORMATS
                    or source.width * source.height > MAX_IMAGE_PIXELS
                    or getattr(source, "is_animated", False)
                ):
                    raise InvalidThumbnail
                source.verify()
            with Image.open(io.BytesIO(contents)) as source:
                source.load()
                oriented = ImageOps.exif_transpose(source).convert("RGBA")
                if square:
                    oriented = ImageOps.fit(oriented, THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
                else:
                    oriented.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
                clean = Image.new("RGBA", oriented.size)
                clean.paste(oriented)
                output = io.BytesIO()
                clean.save(output, format="WEBP", lossless=True)
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombWarning,
        Image.DecompressionBombError,
    ) as exc:
        raise InvalidThumbnail from exc
