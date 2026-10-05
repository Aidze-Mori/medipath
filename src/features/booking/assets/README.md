# Synthetic doctor portraits

Generated with the built-in `image_gen` tool on 5 October 2026. These are fictional people, not photographs or credentials of real doctors. The UI labels the entire catalog as synthetic. Two female and two male portraits are reused across four demo specialties with gender-consistent profiles. Source images were copied unchanged into this folder and are imported through Vite; they are not external URLs or dependencies on the Codex image cache.

Files: `portrait-1.png`, `portrait-2.png`, `portrait-3.png`, `portrait-4.png` (1254 × 1254 PNG, approximately 6.8 MiB total). They are lazy loaded; initials remain behind the image and are shown if loading fails.

Prompt template used in four independent built-in calls:

> Use case: photorealistic-natural. Asset type: small doctor avatar for a synthetic medical appointment demo, standalone square photo, ideally 512 x 512. Create a realistic studio headshot of one {subject}. Head and shoulders, white coat over plain neutral shirt, no stethoscope needed, centered face with space for circular crop. Soft even daylight, pale warm gray white studio background, contemporary Russian clinic website aesthetic, natural skin texture. Completely fictional person, no resemblance requested to any real physician or celebrity. No writing, no labels, no watermark, no logos, no border, no collage. Only one person.

Subjects in file order:

1. fictional female physician age 38, medium brown bob haircut, calm warm expression
2. fictional male physician age 43, short dark hair, clean shaven, calm warm expression
3. fictional female physician age 48, shoulder length light brown hair, calm warm expression
4. fictional male physician age 35, short brown hair, subtle beard, calm warm expression

Actual generated dimensions differ from the preferred prompt size. No real person or patient image was supplied.
