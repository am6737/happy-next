import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BaseModal } from './BaseModal';
import { CustomModalConfig } from '../types';

interface CustomModalProps {
    config: CustomModalConfig;
    onClose: () => void;
}

export function CustomModal({ config, onClose }: CustomModalProps) {
    const Component = config.component;
    // Closing fades the modal out first; it leaves the stack once the fade is done
    const [visible, setVisible] = useState(true);
    const closingRef = useRef(false);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const close = useCallback(() => {
        closingRef.current = true;
        setVisible(false);
    }, []);
    // A modal shown over this one mid-fade unmounts it; it still has to leave the stack
    useEffect(() => () => {
        if (closingRef.current) onCloseRef.current();
    }, []);

    return (
        <BaseModal visible={visible} onClose={close} onExited={onClose}>
            <Component {...config.props} onClose={close} />
        </BaseModal>
    );
}

