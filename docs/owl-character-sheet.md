# Botholomew Owl — Character Sheet

The Botholomew mascot is a small ASCII owl. All poses are 3 lines tall and
roughly 7 characters wide so they can be swapped frame-by-frame in the TUI.

---

## Base / Neutral

```
 {o,o}
 /)_)
  " "
```

---

## Emotions

### Happy
```
 {^,^}
 /)_)
  " "
```

### Excited
```
 {*,*}
 /)_)
  " "
```

### Sad
```
 {;,;}
 /)_)
  " "
```

### Surprised
```
 {O,O}
 /)_)
  " "
```

### Sleeping
```
 {-,-}
 /)_)
  " "
```

### Thinking
```
 {o,o}
 /)_) ?
  " "
```

### Confused
```
 {o,o}
 /)_) ~
  " "
```

### Dizzy
```
 {@,@}
 /)_)
  " "
```

### Alert / Error
```
 {!,!}
 /)_)
  " "
```

---

## Directional

### Wink
```
 {-,o}
 /)_)
  " "
```

### Looking Left
```
 {o,o}
 (_(\ 
  " "
```

### Looking Right
```
 {o,o}
 /)_)
  " "
```

---

## Poses

### Wings Up (celebrating)
```
 {^,^}
/)   (\
  " "
```

### Wings Out (presenting)
```
 {o,o}
/)_)/>
  " "
```

### Reading
```
 {o,o}
 /)_)
 _|"|_
```

### Typing
```
 {o,o}
 /)_)
 _|||_
```

---

## Animation Sequences

### Idle (looping)
Slow blink cycle, ~400ms per frame:

```
Frame 0:  Frame 1:  Frame 2:  Frame 3:
 {o,o}    {o,o}     {-,-}     {o,o}
 /)_)     /)_)      /)_)      /)_)
  " "      " "       " "       " "
```

### Thinking (looping)
Eyes shift side to side while thinking:

```
Frame 0:  Frame 1:  Frame 2:  Frame 3:
 {o,o}    {o,o}     {o,o}     {o,o}
 /)_) ?   /)_) .    /)_) ..   /)_) ...
  " "      " "       " "       " "
```

### Working (looping)
Typing animation:

```
Frame 0:  Frame 1:  Frame 2:  Frame 3:
 {o,o}    {-,o}     {o,o}     {o,-}
 /)_)     /)_)      /)_)      /)_)
 _|||_    _|||_     _|||_     _|||_
```

### Success
Quick celebration:

```
Frame 0:  Frame 1:  Frame 2:
 {o,o}    {^,^}     {^,^}
 /)_)    /)   (\   /)   (\
  " "      " "       " "
```

### Error
Surprise then alert:

```
Frame 0:  Frame 1:  Frame 2:
 {o,o}    {O,O}     {!,!}
 /)_)     /)_)      /)_)
  " "      " "       " "
```

### Startup
Wake-up sequence (play once):

```
Frame 0:  Frame 1:  Frame 2:  Frame 3:  Frame 4:
 {-,-}    {-,-}     {o,-}     {o,o}     {^,^}
 /)_)     /)_)      /)_)      /)_)      /)_)
  " "      " "       " "       " "       " "
```
