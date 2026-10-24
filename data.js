/**
 * 绘本系列 / 级别 / 打卡分值配置
 *
 * score = 每读完一本该级别的绘本可获得的积分
 * 想调整分值，直接改这里即可，页面会自动同步。
 */
window.SERIES_DATA = [
  {
    id: 'heinemann',
    name: '海尼曼',
    en: 'Heinemann',
    note: '字母越靠后，难度越大',
    levels: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].map(function (letter, i) {
      // 色阶：低级别偏薄荷绿，高级别偏靛紫
      var hue = 152 + (i / 13) * 128;
      return {
        id: letter,
        label: letter,
        title: 'Level ' + letter,
        score: i + 2,
        color1: 'hsl(' + hue + ', 62%, 62%)',
        color2: 'hsl(' + (hue + 16) + ', 58%, 40%)',
      };
    }),
  },
  {
    id: 'random-house',
    name: '兰登分级英语',
    en: 'Step into Reading',
    note: '数字越大，难度越大',
    levels: [
      {
        id: '1',
        label: '1',
        title: 'Level 1 · 红色',
        subtitle: 'Red',
        score: 3,
        color1: '#f2656a',
        color2: '#c22f3a',
      },
      {
        id: '2',
        label: '2',
        title: 'Level 2 · 绿色',
        subtitle: 'Green',
        score: 5,
        color1: '#4cc38a',
        color2: '#1f8a5b',
      },
      {
        id: '3',
        label: '3',
        title: 'Level 3 · 紫色',
        subtitle: 'Purple',
        score: 8,
        color1: '#a97bf5',
        color2: '#6d3fc4',
      },
    ],
  },
  {
    id: 'oxford',
    name: '牛津树',
    en: 'Oxford Reading Tree',
    note: '数字越大，难度越大',
    levels: [
      { id: '1', label: '1', title: 'Level 1 · 浅灰', score: 2, color1: '#cfd4de', color2: '#8f97a8' },
      { id: '2', label: '2', title: 'Level 2 · 深灰', score: 3, color1: '#7c8496', color2: '#414855' },
      { id: '3', label: '3', title: 'Level 3 · 蓝色', score: 4, color1: '#5b8cff', color2: '#2a4fc0' },
      { id: '4', label: '4', title: 'Level 4 · 红色', score: 6, color1: '#f2656a', color2: '#c22f3a' },
      { id: '5', label: '5', title: 'Level 5 · 黄色', score: 8, color1: '#ffc44d', color2: '#d98b12' },
    ],
  },
  {
    id: 'raz',
    name: 'RAZ Reading',
    en: 'Reading A-Z',
    note: '字母越靠后，难度越大',
    levels: [
      {
        id: 'aa',
        label: 'AA',
        title: 'Level aa',
        subtitle: 'Starter',
        score: 1,
        color1: '#9fe6c4',
        color2: '#3f9e78',
      },
      {
        id: 'a',
        label: 'A',
        title: 'Level A',
        subtitle: 'Beginning',
        score: 2,
        color1: '#7fd0f5',
        color2: '#2579b0',
      },
      {
        id: 'b',
        label: 'B',
        title: 'Level B',
        subtitle: 'Early',
        score: 3,
        color1: '#c1a7f7',
        color2: '#6b41cc',
      },
    ],
  },
  {
    id: 'first-i-can-read',
    name: 'First I Can Read Book',
    en: 'I Can Read!',
    note: '角色越靠后，难度越大',
    levels: [
      {
        id: 'biscuit',
        label: '饼干狗',
        title: '饼干狗 Biscuit',
        subtitle: 'My First I Can Read',
        score: 3,
        color1: '#e0a068',
        color2: '#a8602f',
      },
      {
        id: 'critter',
        label: '小毛怪',
        title: '小毛怪 Little Critter',
        subtitle: 'Level 1 I Can Read',
        score: 5,
        color1: '#8f7bf0',
        color2: '#4d3bb0',
      },
      {
        id: 'pete',
        label: '皮特猫',
        title: '皮特猫 Pete the Cat',
        subtitle: 'Level 1 I Can Read',
        score: 7,
        color1: '#4aa8f0',
        color2: '#1c5fb5',
      },
    ],
  },
];
