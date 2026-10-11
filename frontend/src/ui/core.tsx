import {
  createContext,
  createElement,
  type ElementType,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type AsProp = { as?: ElementType };
type ChildProps = { children?: ReactNode; className?: string };

/** Join optional class names without leaking booleans into markup. */
function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * Every tone `_ui.scss` paints, including `link`, which is the one with no fill.
 *
 * A name missing from this set is painted as the filled neutral, which is the
 * wrong answer for a control that sits *over* text: without `link` here, a
 * link-styled button — the × on a tag pill — renders as an opaque pill over the
 * text beside it.
 */
export const UI_VARIANT_TONES = new Set([
  "primary",
  "secondary",
  "success",
  "info",
  "warning",
  "danger",
  "light",
  "dark",
  "link",
]);

/** Convert the old visual variant contract to semantic utility classes. */
function variantClass(variant = "secondary", outline = false): string {
  const tone = UI_VARIANT_TONES.has(variant) ? variant : "secondary";
  return `ui-variant-${outline ? "outline-" : ""}${tone}`;
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  AsProp & {
    variant?: string;
    size?: "sm" | "lg";
  };

/** Button primitive with the legacy prop surface and token-driven styling. */
export function Button({
  as = "button",
  variant = "secondary",
  size,
  className,
  type,
  ...props
}: ButtonProps) {
  const outline = variant.startsWith("outline-");
  const tone = outline ? variant.slice("outline-".length) : variant;
  return createElement(as, {
    ...props,
    type: type ?? (as === "button" ? "button" : undefined),
    className: cx(
      "ui-button",
      "btn",
      `btn-${outline ? `outline-${tone}` : tone}`,
      variantClass(tone, outline),
      size && `ui-button-${size} btn-${size}`,
      className,
    ),
  });
}

type AlertProps = HTMLAttributes<HTMLDivElement> & {
  variant?: string;
  dismissible?: boolean;
  onClose?: () => void;
};

/** Status message with an optional dismiss action. */
export function Alert({
  variant = "info",
  dismissible,
  onClose,
  className,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      {...props}
      className={cx(
        "ui-alert",
        "alert",
        `alert-${variant}`,
        variantClass(variant),
        className,
      )}
      role="alert"
    >
      <div className="ui-alert-content">{children}</div>
      {dismissible && (
        <button
          type="button"
          className="ui-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
      )}
    </div>
  );
}

Alert.Heading = function AlertHeading({
  as = "h4",
  className,
  ...props
}: ChildProps & AsProp) {
  return createElement(as, {
    ...props,
    className: cx("ui-alert-heading", className),
  });
};

/** Small state label. */
export function Badge({
  bg = "secondary",
  pill,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { bg?: string; pill?: boolean }) {
  return (
    <span
      {...props}
      className={cx(
        "ui-badge",
        "badge",
        `bg-${bg}`,
        variantClass(bg),
        pill && "ui-badge-pill rounded-pill",
        className,
      )}
    />
  );
}

/**
 * Build a named sub-component — `Card.Body`, `Modal.Footer`, and the like —
 * that renders `defaultAs` with `baseClass` unless the caller overrides `as`.
 * @param name - The part's name, emitted as `data-ui-part`.
 * @param defaultAs - The element or component rendered when `as` is absent.
 * @param baseClass - The class every instance carries.
 * @returns The sub-component.
 */
function elementPart(name: string, defaultAs: ElementType, baseClass: string) {
  return function Part({
    as = defaultAs,
    className,
    ...props
  }: ChildProps & AsProp & Record<string, unknown>) {
    return createElement(as, {
      ...props,
      className: cx(baseClass, className),
      "data-ui-part": name,
    });
  };
}

/** Surface container and its structural parts. */
export function Card({
  border,
  variant,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { border?: string; variant?: string }) {
  return (
    <section
      {...props}
      className={cx(
        "ui-card",
        "card",
        border && `ui-card-border-${border}`,
        variant && `ui-card-${variant}`,
        className,
      )}
    />
  );
}

Card.Header = elementPart("card-header", "div", "ui-card-header card-header");
Card.Body = elementPart("card-body", "div", "ui-card-body card-body");
Card.Footer = elementPart("card-footer", "div", "ui-card-footer card-footer");
Card.Title = elementPart("card-title", "h5", "ui-card-title card-title");
Card.Text = elementPart("card-text", "p", "ui-card-text card-text");

/** Bounded page container. */
export function Container({
  as = "div",
  fluid,
  className,
  ...props
}: ChildProps & AsProp & { fluid?: boolean } & Record<string, unknown>) {
  return createElement(as, {
    ...props,
    className: cx(
      "ui-container",
      fluid ? "ui-container-fluid container-fluid" : "container",
      className,
    ),
  });
}

type BreakpointValue = number | string | boolean | { span?: number | string };

/** Twelve-column layout row. */
export function Row({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("ui-row", "row", className)} />;
}

/** Responsive column. */
export function Col({
  xs,
  sm,
  md,
  lg,
  xl,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  xs?: BreakpointValue;
  sm?: BreakpointValue;
  md?: BreakpointValue;
  lg?: BreakpointValue;
  xl?: BreakpointValue;
}) {
  const columns = { xs, sm, md, lg, xl };
  return (
    <div
      {...props}
      className={cx(
        "ui-col",
        "col",
        ...Object.entries(columns).map(([key, value]) =>
          value === undefined
            ? ""
            : `ui-col-${key}-${typeof value === "object" ? (value.span ?? "auto") : value === true ? "auto" : value}`,
        ),
        className,
      )}
    />
  );
}

const DropdownContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

/** Disclosure menu. */
export function Dropdown({
  align,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { align?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    /**
     * Close the menu when a pointer goes down outside it.
     * @param event - The pointer event.
     */
    function closeOutside(event: PointerEvent): void {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    /**
     * Close the menu on Escape.
     * @param event - The key event.
     */
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  return (
    <DropdownContext.Provider value={{ open, setOpen }}>
      <div
        {...props}
        ref={root}
        className={cx("ui-dropdown", "dropdown", className)}
        data-align={align}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          props.onKeyDown?.(event);
        }}
      >
        {children}
      </div>
    </DropdownContext.Provider>
  );
}

Dropdown.Toggle = function DropdownToggle({
  as = "button",
  className,
  children,
  ...props
}: ChildProps & AsProp & Record<string, unknown>) {
  const context = useContext(DropdownContext);
  return createElement(as, {
    ...props,
    className: cx("ui-dropdown-toggle", "dropdown-toggle", className),
    "aria-expanded": context?.open ?? false,
    role: props.role ?? "button",
    tabIndex: props.tabIndex ?? 0,
    onClick: (event: React.MouseEvent) => {
      (props.onClick as ((event: React.MouseEvent) => void) | undefined)?.(
        event,
      );
      context?.setOpen(!context.open);
    },
    children,
  });
};

Dropdown.Menu = function DropdownMenu({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const context = useContext(DropdownContext);
  if (!context?.open) return null;
  return (
    <div
      {...props}
      className={cx("ui-dropdown-menu", "dropdown-menu show", className)}
      role="menu"
    />
  );
};

Dropdown.Item = function DropdownItem({
  as = "button",
  active,
  disabled,
  className,
  children,
  ...props
}: ChildProps &
  AsProp & {
    active?: boolean;
    disabled?: boolean;
  } & Record<string, unknown>) {
  const context = useContext(DropdownContext);
  return createElement(as, {
    ...props,
    disabled: as === "button" ? disabled : undefined,
    "aria-disabled": disabled || undefined,
    tabIndex: disabled ? -1 : props.tabIndex,
    className: cx(
      "ui-dropdown-item",
      "dropdown-item",
      active && "active",
      disabled && "disabled",
      className,
    ),
    role: "menuitem",
    onClick: (event: React.MouseEvent) => {
      if (disabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      (props.onClick as ((event: React.MouseEvent) => void) | undefined)?.(
        event,
      );
      context?.setOpen(false);
    },
    children,
  });
};

Dropdown.Header = elementPart(
  "dropdown-header",
  "div",
  "ui-dropdown-header dropdown-header",
);
Dropdown.Divider = function DropdownDivider() {
  return <hr className="ui-dropdown-divider dropdown-divider" />;
};

const FormGroupContext = createContext<string | undefined>(undefined);

/** Native form wrapper with namespaced subcomponents. */
export function Form({
  className,
  ...props
}: React.FormHTMLAttributes<HTMLFormElement>) {
  return <form {...props} className={cx("ui-form", className)} />;
}

Form.Group = function FormGroup({
  controlId,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { controlId?: string }) {
  return (
    <FormGroupContext.Provider value={controlId}>
      <div {...props} className={cx("ui-form-group", className)}>
        {children}
      </div>
    </FormGroupContext.Provider>
  );
};

Form.Label = function FormLabel({
  className,
  htmlFor,
  visuallyHidden,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & {
  visuallyHidden?: boolean;
}) {
  const controlId = useContext(FormGroupContext);
  return (
    <label
      {...props}
      htmlFor={htmlFor ?? controlId}
      className={cx(
        "ui-form-label form-label",
        visuallyHidden && "visually-hidden",
        className,
      )}
    />
  );
};

type ControlProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size"
> & {
  as?: "input" | "textarea";
  rows?: number;
  size?: "sm" | "lg";
  isInvalid?: boolean;
  plaintext?: boolean;
};

const FormControl = function FormControl({
  as = "input",
  className,
  id,
  size,
  isInvalid,
  plaintext,
  ...props
}: ControlProps) {
  const controlId = useContext(FormGroupContext);
  const classes = cx(
    plaintext
      ? "ui-form-plaintext form-control-plaintext"
      : "ui-form-control form-control",
    size && `ui-form-control-${size} form-control-${size}`,
    isInvalid && "is-invalid",
    className,
  );
  if (as === "textarea") {
    return (
      <textarea
        {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        id={id ?? controlId}
        className={classes}
      />
    );
  }
  return <input {...props} id={id ?? controlId} className={classes} />;
};

const FormFeedback = elementPart(
  "form-feedback",
  "div",
  "ui-form-feedback invalid-feedback",
);
FormControl.Feedback = FormFeedback;
Form.Control = FormControl;

Form.Select = function FormSelect({
  className,
  id,
  size,
  isInvalid,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  size?: "sm" | "lg";
  isInvalid?: boolean;
}) {
  const controlId = useContext(FormGroupContext);
  return (
    <select
      {...props}
      id={id ?? controlId}
      className={cx(
        "ui-form-select",
        "form-select",
        size && `ui-form-select-${size} form-select-${size}`,
        isInvalid && "is-invalid",
        className,
      )}
    />
  );
};

Form.Check = function FormCheck({
  type = "checkbox",
  label,
  className,
  inline,
  reverse,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  inline?: boolean;
  reverse?: boolean;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label
      className={cx(
        "ui-form-check form-check",
        type === "switch" && "form-switch",
        inline && "ui-form-check-inline form-check-inline",
        reverse && "ui-form-check-reverse form-check-reverse",
        className,
      )}
      htmlFor={inputId}
    >
      <input
        {...props}
        id={inputId}
        type={type === "switch" ? "checkbox" : type}
        role={type === "switch" ? "switch" : undefined}
        className="ui-form-check-input form-check-input"
      />
      {label !== undefined && (
        <span className="ui-form-check-label">{label}</span>
      )}
    </label>
  );
};

Form.Text = elementPart("form-text", "small", "ui-form-text form-text");

/** Selectable stacked list. */
export function ListGroup({
  variant,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: string }) {
  return (
    <div
      {...props}
      className={cx(
        "ui-list-group list-group",
        variant && `ui-list-group-${variant}`,
        className,
      )}
    />
  );
}

ListGroup.Item = function ListGroupItem({
  action,
  active,
  disabled,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  action?: boolean;
  active?: boolean;
}) {
  return createElement(action ? "button" : "div", {
    ...props,
    type: action ? (props.type ?? "button") : undefined,
    disabled: action ? disabled : undefined,
    className: cx(
      "ui-list-group-item",
      "list-group-item",
      action && "ui-list-group-action",
      active && "active",
      disabled && "disabled",
      className,
    ),
    children,
  });
};

const ModalContext = createContext<{ onHide?: () => void }>({});

/** Accessible modal dialog rendered in place. */
export function Modal({
  show,
  onHide,
  size,
  centered,
  backdrop,
  keyboard = true,
  className,
  children,
  ...props
}: ChildProps & {
  show?: boolean;
  onHide?: () => void;
  size?: string;
  centered?: boolean;
  backdrop?: boolean | "static";
  keyboard?: boolean;
} & Omit<HTMLAttributes<HTMLDivElement>, "children">) {
  useEffect(() => {
    if (!show || !keyboard) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onHide?.();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [keyboard, onHide, show]);
  if (!show) return null;
  return (
    <ModalContext.Provider value={{ onHide }}>
      <div
        {...props}
        className={cx(
          "ui-modal-backdrop",
          "modal show",
          centered && "centered",
        )}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && backdrop !== "static") {
            onHide?.();
          }
        }}
      >
        <div
          className={cx(
            "ui-modal modal-dialog modal-content",
            size && `ui-modal-${size} modal-${size}`,
            className,
          )}
          role="dialog"
          aria-modal="true"
        >
          {children}
        </div>
      </div>
    </ModalContext.Provider>
  );
}

Modal.Header = function ModalHeader({
  closeButton,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { closeButton?: boolean }) {
  const { onHide } = useContext(ModalContext);
  return (
    <div {...props} className={cx("ui-modal-header modal-header", className)}>
      {children}
      {closeButton && (
        <button
          type="button"
          className="ui-close"
          aria-label="Close"
          onClick={onHide}
        >
          ×
        </button>
      )}
    </div>
  );
};
Modal.Title = elementPart("modal-title", "h5", "ui-modal-title modal-title");
Modal.Body = elementPart("modal-body", "div", "ui-modal-body modal-body");
Modal.Footer = elementPart(
  "modal-footer",
  "div",
  "ui-modal-footer modal-footer",
);

/** Horizontal navigation. */
export function Nav({
  variant,
  fill,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant?: string; fill?: boolean }) {
  return (
    <nav
      {...props}
      className={cx(
        "ui-nav nav",
        variant && `ui-nav-${variant} nav-${variant}`,
        fill && "ui-nav-fill nav-fill",
        className,
      )}
    />
  );
}

Nav.Link = function NavLink({
  as = "a",
  active,
  disabled,
  className,
  ...props
}: ChildProps &
  AsProp & {
    active?: boolean;
    disabled?: boolean;
    end?: boolean;
    to?: string;
    type?: string;
  } & Record<string, unknown>) {
  return createElement(as, {
    ...props,
    disabled,
    className: cx(
      "ui-nav-link",
      "nav-link",
      active && "active",
      disabled && "disabled",
      className,
    ),
  });
};
Nav.Item = elementPart("nav-item", "div", "ui-nav-item nav-item");

const NavbarContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  expand?: string;
} | null>(null);

/** Responsive application navigation. */
export function Navbar({
  expand,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { expand?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <NavbarContext.Provider value={{ open, setOpen, expand }}>
      <nav
        {...props}
        className={cx(
          "ui-navbar navbar",
          expand && `ui-navbar-expand-${expand} navbar-expand-${expand}`,
          className,
        )}
      >
        {children}
      </nav>
    </NavbarContext.Provider>
  );
}

Navbar.Brand = elementPart("navbar-brand", "a", "ui-navbar-brand navbar-brand");
Navbar.Toggle = function NavbarToggle({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(NavbarContext);
  return (
    <button
      {...props}
      type="button"
      className={cx("ui-navbar-toggle navbar-toggler", className)}
      aria-expanded={context?.open ?? false}
      onClick={(event) => {
        props.onClick?.(event);
        context?.setOpen(!context.open);
      }}
    >
      <span aria-hidden="true">☰</span>
      <span className="visually-hidden">Toggle navigation</span>
    </button>
  );
};
/**
 * Collapsible nav region. On a phone it closes after a destination is chosen,
 * so the menu does not stay over the page the reader just asked for.
 */
Navbar.Collapse = function NavbarCollapse({
  className,
  onClick,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const context = useContext(NavbarContext);
  return (
    <div
      {...props}
      className={cx(
        "ui-navbar-collapse",
        "navbar-collapse",
        context?.open && "show",
        context?.expand && `expand-${context.expand}`,
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        // Dropdown toggles intentionally wear `nav-link` styling. Closing on
        // those would hide the collapsed region at the same moment its menu is
        // inserted, making every navbar dropdown unreachable on a phone.
        if (
          target.closest(
            "a.nav-link:not(.dropdown-toggle), a.dropdown-item, button.dropdown-item",
          )
        ) {
          context?.setOpen(false);
        }
      }}
    />
  );
};

/** Pagination list and item controls. */
export function Pagination({
  size,
  className,
  ...props
}: HTMLAttributes<HTMLUListElement> & { size?: "sm" | "lg" }) {
  return (
    <ul
      {...props}
      className={cx(
        "ui-pagination pagination",
        size && `ui-pagination-${size}`,
        className,
      )}
    />
  );
}

/**
 * One page button in a `Pagination`.
 * @param props - Button attributes, plus `active` for the current page.
 * @returns The rendered page item.
 */
function PaginationItem({
  active,
  disabled,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <li className="ui-page-item page-item">
      <button
        {...props}
        type="button"
        disabled={disabled}
        className={cx(
          "ui-page-link",
          "page-link",
          active && "active",
          disabled && "disabled",
          className,
        )}
      >
        {children}
      </button>
    </li>
  );
}

Pagination.Item = PaginationItem;
Pagination.First = (props: React.ComponentProps<typeof PaginationItem>) => (
  <PaginationItem aria-label="First page" {...props}>
    «
  </PaginationItem>
);
Pagination.Prev = (props: React.ComponentProps<typeof PaginationItem>) => (
  <PaginationItem aria-label="Previous page" {...props}>
    ‹
  </PaginationItem>
);
Pagination.Next = (props: React.ComponentProps<typeof PaginationItem>) => (
  <PaginationItem aria-label="Next page" {...props}>
    ›
  </PaginationItem>
);
Pagination.Last = (props: React.ComponentProps<typeof PaginationItem>) => (
  <PaginationItem aria-label="Last page" {...props}>
    »
  </PaginationItem>
);
Pagination.Ellipsis = () => (
  <li className="ui-page-item" aria-hidden="true">
    <span className="ui-page-link">…</span>
  </li>
);

/** Determinate progress indicator. */
export function ProgressBar({
  now = 0,
  min = 0,
  max = 100,
  label,
  variant = "primary",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  now?: number;
  min?: number;
  max?: number;
  label?: ReactNode;
  variant?: string;
}) {
  const percentage = Math.max(
    0,
    Math.min(100, ((now - min) / Math.max(1, max - min)) * 100),
  );
  return (
    <div
      {...props}
      className={cx("ui-progress progress", className)}
      role="progressbar"
      aria-valuenow={now}
      aria-valuemin={min}
      aria-valuemax={max}
    >
      <div
        className={cx(
          "ui-progress-bar progress-bar",
          `bg-${variant}`,
          variantClass(variant),
        )}
        style={{ width: `${percentage}%` }}
      >
        {label}
      </div>
    </div>
  );
}

/** Inline loading marker. */
export function Spinner({
  animation: _animation,
  size,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  animation?: string;
  size?: string;
}) {
  return (
    <span
      {...props}
      className={cx(
        "ui-spinner spinner-border",
        size && `ui-spinner-${size} spinner-border-${size}`,
        className,
      )}
      role={props.role ?? "status"}
    />
  );
}

/** Data table, optionally wrapped for horizontal scrolling. */
export function Table({
  responsive,
  striped,
  bordered,
  borderless,
  hover,
  size,
  variant,
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & {
  responsive?: boolean | string;
  striped?: boolean;
  bordered?: boolean;
  borderless?: boolean;
  hover?: boolean;
  size?: string;
  variant?: string;
}) {
  const table = (
    <table
      {...props}
      className={cx(
        "ui-table",
        "table",
        striped && "ui-table-striped table-striped",
        bordered && "ui-table-bordered table-bordered",
        borderless && "ui-table-borderless table-borderless",
        hover && "ui-table-hover table-hover",
        size && `ui-table-${size} table-${size}`,
        variant && `ui-table-${variant} table-${variant}`,
        className,
      )}
    />
  );
  return (
    <div
      className="ui-table-responsive table-responsive"
      data-responsive={responsive || undefined}
    >
      {table}
    </div>
  );
}
