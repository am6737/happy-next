import * as React from 'react';
import { DatePicker, type DatePickerProps } from './DatePicker';

export type DatePickerPopoverProps = DatePickerProps & {
    visible: boolean;
    /** Asked when the user clicks away or presses Escape (web only). */
    onClose: () => void;
};

/**
 * Shows the picker when `visible`. Here, on native, it simply sits in the layout; the web build
 * floats it above its anchor instead so it does not push the surrounding form around.
 */
export function DatePickerPopover({ visible, onClose: _onClose, ...pickerProps }: DatePickerPopoverProps) {
    return visible ? <DatePicker {...pickerProps} /> : null;
}
