/** The uploaded-image pointer's display projection: text back into a gallery image. */

import { describe, expect, it } from 'vitest'
import { parseUploadedImagePointer } from '../src/client/chat/MessageItem.tsx'

const ID = 'sha256:' + '0'.repeat(64)

describe('parseUploadedImagePointer', () => {
  it('projects a bridge pointer into a loadable attachment reference', () => {
    expect(parseUploadedImagePointer(
      `[uploaded image: shot.png (412x620, image/png); view it with view_image, passing attachment_id="${ID}" verbatim]`,
    )).toEqual({
      attachment: {
        attachmentId: ID,
        mediaType: 'image/png',
        bytes: 0,
        width: 412,
        height: 620,
        name: 'shot.png',
      },
    })
  })

  it('accepts surrounding whitespace and the nameless fallback label', () => {
    expect(parseUploadedImagePointer(
      `  [uploaded image: image (2x2, image/jpeg); view it with view_image, passing attachment_id="${ID}" verbatim]  `,
    )).toMatchObject({ attachment: { mediaType: 'image/jpeg', width: 2, height: 2, name: 'image' } })
  })

  it('leaves ordinary text alone', () => {
    expect(parseUploadedImagePointer('describe this image please')).toBeUndefined()
    expect(parseUploadedImagePointer('[uploaded image: x.png (1x1, image/png); some other tail]')).toBeUndefined()
  })
})
