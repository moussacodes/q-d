import { render, screen } from '@testing-library/react-native';

import { QR_QUIET_ZONE, QrCode, qrPath } from './QrCode';

const link = 'qd://join?invite=mock-0123456789abcdef0123456789abcdef';

describe('qrPath', () => {
  it('draws the same code for the same value', () => {
    expect(qrPath(link)).toEqual(qrPath(link));
  });

  it('draws a different code for a different value', () => {
    expect(qrPath(link).path).not.toBe(qrPath(`${link}0`).path);
  });

  it('leaves the quiet zone empty around the modules', () => {
    const { path, modules, extent } = qrPath(link);
    expect(extent).toBe(modules + QR_QUIET_ZONE * 2);
    const squares = [...path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(([, x, y]) => [+x, +y]);
    expect(squares.length).toBeGreaterThan(modules * 4);
    for (const [x, y] of squares) {
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(x).toBeLessThan(QR_QUIET_ZONE + modules);
      expect(y).toBeLessThan(QR_QUIET_ZONE + modules);
    }
    // The top-left finder pattern starts in the code's first module.
    expect(path.startsWith(`M${QR_QUIET_ZONE} ${QR_QUIET_ZONE}h1v1h-1z`)).toBe(true);
  });
});

describe('QrCode', () => {
  it('is one image for screen readers', async () => {
    await render(
      <QrCode value={link} color="#000" background="#fff" accessibilityLabel="QR code" />,
    );
    const image = screen.getByLabelText('QR code');
    expect(image.props.accessibilityRole).toBe('image');
    expect(image.props.accessible).toBe(true);
  });
});
